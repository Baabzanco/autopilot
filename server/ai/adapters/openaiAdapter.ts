import { detectImageDimensions } from '../../media/dimensions';
import type {
  AiProviderConfig,
  ImageGenRequest,
  ImageGenResult,
  ImageGeneratedItem,
  ProviderConnectionTestResult,
  StructuredJsonRequest,
  StructuredJsonResult,
  TtsGenRequest,
  TtsGenResult,
} from '../types';
import { ProviderExecutionError, type AiProviderAdapter } from './base';

function getBaseUrl(config: AiProviderConfig): string {
  return (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function mapOpenAiImageSize(aspectRatio?: string): string {
  if (aspectRatio === '9:16' || aspectRatio === '4:5' || aspectRatio === '3:4') return '1024x1536';
  if (aspectRatio === '16:9' || aspectRatio === '4:3') return '1536x1024';
  return '1024x1024';
}

export const openaiAdapter: AiProviderAdapter = {
  id: 'openai',

  async testConnection(apiKey: string, config: AiProviderConfig): Promise<ProviderConnectionTestResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    if (!apiKey.trim()) {
      return {
        ok: false,
        providerId: 'openai',
        status: 'not_configured',
        latencyMs: Date.now() - start,
        message: 'کلید API سرویس OpenAI تنظیم نشده است.',
        checkedAt,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs || 15000, 15000));
    try {
      const res = await fetch(`${getBaseUrl(config)}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return {
          ok: false,
          providerId: 'openai',
          status: 'error',
          latencyMs,
          message: `OpenAI خطای ${res.status} برگرداند: ${errBody?.error?.message || res.statusText}`.slice(0, 240),
          checkedAt,
        };
      }

      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const detectedModels = (data.data ?? []).slice(0, 10).map((m) => m.id);
      return {
        ok: true,
        providerId: 'openai',
        status: 'connected',
        latencyMs,
        message: `اتصال موفق به OpenAI (${(data.data ?? []).length} مدل در دسترس).`,
        detectedModels,
        checkedAt,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        providerId: 'openai',
        status: 'error',
        latencyMs: Date.now() - start,
        message: `خطا در اتصال به OpenAI: ${msg.slice(0, 220)}`,
        checkedAt,
      };
    }
  },

  async generateStructuredJson(
    apiKey: string,
    req: StructuredJsonRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<StructuredJsonResult> {
    const res = await fetch(`${getBaseUrl(config)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: req.modelId,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${req.systemInstruction}\nخروجی باید دقیقاً JSON معتبر مطابق ساختار خواسته‌شده باشد.`,
          },
          { role: 'user', content: req.contents },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const msg = errJson?.error?.message || `OpenAI HTTP ${res.status}`;
      throw new ProviderExecutionError(msg, {
        status: res.status,
        code: res.status === 429 ? 'QUOTA_EXCEEDED' : 'OPENAI_ERROR',
        retryable: res.status === 429 || res.status >= 500,
      });
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const estimatedCostUsd = Number((inputTokens * 0.0000004 + outputTokens * 0.0000016).toFixed(6));

    return {
      parsed,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      modelUsed: req.modelId,
    };
  },

  async generateImage(
    apiKey: string,
    req: ImageGenRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<ImageGenResult> {
    const size = mapOpenAiImageSize(req.aspectRatio);
    const n = Math.min(4, Math.max(1, Math.round(req.numberOfImages || 1)));
    const compiledPrompt = [
      req.prompt.trim(),
      req.styleInstructions?.trim() ? `Style: ${req.styleInstructions.trim()}` : '',
      req.negativePrompt?.trim() ? `Avoid: ${req.negativePrompt.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const ref =
      req.referenceImages?.[0] ||
      (req.referenceImageBase64 && req.referenceImageMimeType
        ? { base64: req.referenceImageBase64, mimeType: req.referenceImageMimeType }
        : null);

    let res: globalThis.Response;
    if (ref?.base64) {
      const form = new FormData();
      const buf = Buffer.from(ref.base64, 'base64');
      const ext = ref.mimeType.includes('jpeg') ? 'jpg' : ref.mimeType.includes('webp') ? 'webp' : 'png';
      form.append('model', req.modelId);
      form.append('prompt', compiledPrompt);
      form.append('size', size);
      form.append('n', String(n));
      form.append('image', new Blob([buf], { type: ref.mimeType }), `reference.${ext}`);

      res = await fetch(`${getBaseUrl(config)}/images/edits`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: form,
        signal,
      });
    } else {
      res = await fetch(`${getBaseUrl(config)}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: req.modelId,
          prompt: compiledPrompt,
          size,
          n,
        }),
        signal,
      });
    }

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new ProviderExecutionError(errJson?.error?.message || `OpenAI Image HTTP ${res.status}`, {
        status: res.status,
        code:
          res.status === 401 || res.status === 403
            ? 'PAID_KEY_OR_AUTH_REQUIRED'
            : res.status === 429
            ? 'QUOTA_EXCEEDED'
            : 'OPENAI_IMAGE_ERROR',
        retryable: res.status === 429 || res.status >= 500,
      });
    }

    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const rawItems = data.data ?? [];
    const images: ImageGeneratedItem[] = [];

    for (const item of rawItems) {
      let b64 = item.b64_json;
      let mime = 'image/png';
      if (!b64 && item.url) {
        const fetched = await fetch(item.url, { signal });
        const arrBuf = await fetched.arrayBuffer();
        b64 = Buffer.from(arrBuf).toString('base64');
        mime = fetched.headers.get('content-type') || 'image/png';
      }
      if (b64) {
        const dims = await detectImageDimensions(Buffer.from(b64, 'base64'), 'png');
        images.push({
          dataBase64: b64,
          mimeType: mime,
          width: dims.width,
          height: dims.height,
        });
      }
    }

    if (images.length === 0) {
      throw new ProviderExecutionError('OpenAI خروجی تصویری برنگرداند.', {
        status: 502,
        code: 'EMPTY_IMAGE_RESPONSE',
        retryable: true,
      });
    }

    return {
      images,
      dataBase64: images[0].dataBase64,
      mimeType: images[0].mimeType,
      width: images[0].width,
      height: images[0].height,
      modelUsed: req.modelId,
      estimatedCostUsd: Number((0.04 * images.length).toFixed(4)),
      generationMetadata: { size, edited: Boolean(ref?.base64) },
    };
  },

  async generateSpeech(
    apiKey: string,
    req: TtsGenRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<TtsGenResult> {
    const res = await fetch(`${getBaseUrl(config)}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: req.modelId,
        input: req.text,
        voice: req.voiceName || 'alloy',
        response_format: 'mp3',
      }),
      signal,
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new ProviderExecutionError(errJson?.error?.message || `OpenAI TTS HTTP ${res.status}`, {
        status: res.status,
        code: 'OPENAI_TTS_ERROR',
        retryable: res.status === 429 || res.status >= 500,
      });
    }

    const arrBuf = await res.arrayBuffer();
    return {
      audioBase64: Buffer.from(arrBuf).toString('base64'),
      mimeType: 'audio/mpeg',
      modelUsed: req.modelId,
      estimatedCostUsd: Number(((req.text.length / 1000) * 0.015).toFixed(6)),
    };
  },
};
