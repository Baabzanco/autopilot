import { GoogleGenAI, ThinkingLevel } from '@google/genai';
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

function createClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseStructuredJsonText(rawText: string | undefined): Record<string, unknown> {
  const trimmed = (rawText ?? '').trim();
  if (!trimmed) return {};
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(stripped) as Record<string, unknown>;
}

function isRetryableStatus(status: number, message: string): boolean {
  return (
    status === 503 ||
    status === 429 ||
    status === 500 ||
    status === 504 ||
    message.includes('UNAVAILABLE') ||
    message.includes('high demand') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('AbortError') ||
    message.includes('aborted')
  );
}

function mapGeminiAspectRatio(aspectRatio?: string): string {
  // Gemini image models support 1:1, 3:4, 4:3, 9:16, 16:9 natively.
  // For 4:5 (1080x1350 Instagram portrait/carousel), generate 3:4 and normalize cleanly in media composer.
  if (aspectRatio === '4:5') return '3:4';
  if (aspectRatio === '3:4' || aspectRatio === '4:3' || aspectRatio === '9:16' || aspectRatio === '16:9') {
    return aspectRatio;
  }
  return '1:1';
}

function buildGeminiImagePrompt(req: ImageGenRequest): string {
  const lines = [req.prompt.trim()];
  if (req.styleInstructions?.trim()) {
    lines.push(`Visual Style & Art Direction: ${req.styleInstructions.trim()}`);
  }
  if (req.isVariation) {
    lines.push('Create a fresh creative variation preserving the core subject and brand aesthetic.');
  }
  if (req.negativePrompt?.trim()) {
    lines.push(`Strictly avoid / Negative constraints: ${req.negativePrompt.trim()}`);
  }
  return lines.join('\n\n');
}

export const geminiAdapter: AiProviderAdapter = {
  id: 'gemini',

  async testConnection(apiKey: string, _config: AiProviderConfig): Promise<ProviderConnectionTestResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    if (!apiKey.trim()) {
      return {
        ok: false,
        providerId: 'gemini',
        status: 'not_configured',
        latencyMs: Date.now() - start,
        message: 'کلید API سرویس Gemini تنظیم نشده است.',
        checkedAt,
      };
    }

    try {
      const ai = createClient(apiKey);
      const pager = await ai.models.list({ config: { pageSize: 20 } });
      const detectedModels: string[] = [];
      for await (const model of pager) {
        if (model.name) {
          detectedModels.push(model.name.replace(/^models\//, ''));
        }
        if (detectedModels.length >= 12) break;
      }
      const latencyMs = Date.now() - start;
      return {
        ok: true,
        providerId: 'gemini',
        status: 'connected',
        latencyMs,
        message: `اتصال موفق به Google Gemini (${detectedModels.length} مدل شناسایی شد).`,
        detectedModels,
        checkedAt,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        providerId: 'gemini',
        status: 'error',
        latencyMs,
        message: `خطا در اتصال به Gemini: ${msg.slice(0, 220)}`,
        checkedAt,
      };
    }
  },

  async generateStructuredJson(
    apiKey: string,
    req: StructuredJsonRequest,
    _config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<StructuredJsonResult> {
    try {
      const ai = createClient(apiKey);
      const response = await ai.models.generateContent({
        model: req.modelId,
        contents: req.contents,
        config: {
          systemInstruction: req.systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: req.responseSchema,
          abortSignal: signal,
        },
      });

      const parsed = parseStructuredJsonText(response.text);
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      const estimatedCostUsd = Number((inputTokens * 0.00000015 + outputTokens * 0.0000006).toFixed(6));

      return {
        parsed,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        modelUsed: req.modelId,
      };
    } catch (err: unknown) {
      const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = isRetryableStatus(status, msg);
      const code =
        status === 429 || msg.includes('RESOURCE_EXHAUSTED')
          ? 'QUOTA_EXCEEDED'
          : status === 503 || msg.includes('UNAVAILABLE')
          ? 'MODEL_OVERLOADED'
          : msg.includes('abort') || msg.includes('Abort')
          ? 'TIMEOUT'
          : 'GEMINI_ERROR';
      throw new ProviderExecutionError(msg, { status, code, retryable });
    }
  },

  async generateImage(
    apiKey: string,
    req: ImageGenRequest,
    _config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<ImageGenResult> {
    const count = Math.min(4, Math.max(1, Math.round(req.numberOfImages || 1)));
    const mappedAspect = mapGeminiAspectRatio(req.aspectRatio);
    const supportsImageSize =
      req.modelId === 'gemini-nano-banana-2.1' || req.modelId === 'gemini-3-pro-image';
    const imageConfig: Record<string, string> = {
      aspectRatio: mappedAspect,
    };
    if (supportsImageSize && req.resolution) {
      imageConfig.imageSize = req.resolution;
    }

    const parts: Array<Record<string, unknown>> = [];
    const refs = [
      ...(req.referenceImages ?? []),
      ...(req.referenceImageBase64 && req.referenceImageMimeType
        ? [{ base64: req.referenceImageBase64, mimeType: req.referenceImageMimeType }]
        : []),
    ];
    for (const ref of refs.slice(0, 3)) {
      if (ref.base64 && ref.mimeType) {
        parts.push({
          inlineData: {
            data: ref.base64,
            mimeType: ref.mimeType,
          },
        });
      }
    }
    const compiledPrompt = buildGeminiImagePrompt(req);
    parts.push({ text: compiledPrompt });

    try {
      const ai = createClient(apiKey);
      const images: ImageGeneratedItem[] = [];
      let textNotes: string[] = [];

      for (let i = 0; i < count; i += 1) {
        const iterationParts =
          count > 1
            ? [
                ...parts.slice(0, -1),
                { text: `${compiledPrompt}\n(Composition variation #${i + 1} of ${count})` },
              ]
            : parts;

        const response = await ai.models.generateContent({
          model: req.modelId,
          contents: { parts: iterationParts },
          config: {
            imageConfig,
            abortSignal: signal,
          },
        });

        const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
        let foundImage: ImageGeneratedItem | null = null;
        for (const part of candidateParts) {
          if (part.inlineData?.data && !foundImage) {
            const mimeType = part.inlineData.mimeType || 'image/png';
            const buf = Buffer.from(part.inlineData.data, 'base64');
            const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
            const dims = await detectImageDimensions(buf, ext);
            foundImage = {
              dataBase64: part.inlineData.data,
              mimeType,
              width: dims.width,
              height: dims.height,
            };
          } else if (part.text) {
            textNotes.push(part.text.slice(0, 200));
          }
        }

        if (!foundImage) {
          throw new ProviderExecutionError(
            textNotes.length > 0
              ? `مدل تصویر به جای فایل تصویری فقط متن برگرداند: ${textNotes[0]}`
              : 'مدل تصویر خروجی تصویری برنگرداند.',
            {
              status: 502,
              code: 'EMPTY_IMAGE_RESPONSE',
              retryable: true,
            }
          );
        }
        images.push(foundImage);
      }

      const unitPrice = req.modelId.includes('nano-banana')
        ? 0.06
        : req.modelId.includes('pro-image')
        ? 0.05
        : 0.03;

      return {
        images,
        dataBase64: images[0].dataBase64,
        mimeType: images[0].mimeType,
        width: images[0].width,
        height: images[0].height,
        modelUsed: req.modelId,
        estimatedCostUsd: Number((unitPrice * images.length).toFixed(4)),
        generationMetadata: {
          aspectRatioRequested: req.aspectRatio || '1:1',
          aspectRatioSent: mappedAspect,
          resolution: imageConfig.imageSize || '1K',
          notes: textNotes,
        },
      };
    } catch (err: unknown) {
      if (err instanceof ProviderExecutionError) throw err;
      const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500;
      const msg = err instanceof Error ? err.message : String(err);
      const code =
        status === 403 || status === 401 || msg.includes('PERMISSION_DENIED')
          ? 'PAID_KEY_OR_AUTH_REQUIRED'
          : status === 429 || msg.includes('RESOURCE_EXHAUSTED')
          ? 'QUOTA_EXCEEDED'
          : status === 503 || msg.includes('UNAVAILABLE')
          ? 'MODEL_OVERLOADED'
          : status === 400
          ? 'INVALID_IMAGE_REQUEST'
          : 'GEMINI_IMAGE_ERROR';
      throw new ProviderExecutionError(msg, {
        status,
        code,
        retryable: isRetryableStatus(status, msg),
      });
    }
  },

  async generateSpeech(
    apiKey: string,
    req: TtsGenRequest,
    _config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<TtsGenResult> {
    try {
      const ai = createClient(apiKey);
      const response = await ai.models.generateContent({
        model: req.modelId,
        contents: [
          {
            role: 'user',
            parts: [{ text: req.style ? `${req.style}: ${req.text}` : req.text }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: req.voiceName || 'Kore' },
            },
          },
          abortSignal: signal,
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new ProviderExecutionError('مدل تبدیل متن به گفتار خروجی صوتی برنگرداند.', {
          status: 502,
          code: 'EMPTY_AUDIO_RESPONSE',
          retryable: true,
        });
      }

      return {
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
        modelUsed: req.modelId,
        estimatedCostUsd: Number(((req.text.length / 1000) * 0.012).toFixed(6)),
      };
    } catch (err: unknown) {
      if (err instanceof ProviderExecutionError) throw err;
      const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500;
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderExecutionError(msg, {
        status,
        code: 'GEMINI_TTS_ERROR',
        retryable: isRetryableStatus(status, msg),
      });
    }
  },
};
