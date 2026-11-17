import { detectImageDimensions } from '../../media/dimensions';
import type {
  AiProviderConfig,
  ImageGenRequest,
  ImageGenResult,
  ImageGeneratedItem,
  ProviderConnectionTestResult,
  VideoGenRequest,
  VideoGenResult,
} from '../types';
import { ProviderExecutionError, type AiProviderAdapter } from './base';

function getBaseUrl(config: AiProviderConfig): string {
  return (config.baseUrl || 'https://api.replicate.com/v1').replace(/\/+$/, '');
}

async function runPrediction(
  apiKey: string,
  baseUrl: string,
  modelId: string,
  input: Record<string, unknown>,
  signal: AbortSignal
): Promise<{ output?: unknown }> {
  const createRes = await fetch(`${baseUrl}/models/${modelId}/predictions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
      Prefer: 'wait',
    },
    body: JSON.stringify({ input }),
    signal,
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new ProviderExecutionError(`Replicate HTTP ${createRes.status}: ${errText.slice(0, 180)}`, {
      status: createRes.status,
      code: createRes.status === 429 ? 'QUOTA_EXCEEDED' : 'REPLICATE_ERROR',
      retryable: createRes.status === 429 || createRes.status >= 500,
    });
  }

  let prediction = (await createRes.json()) as {
    id: string;
    status: string;
    output?: unknown;
    error?: string;
    urls?: { get?: string };
  };

  while (
    !signal.aborted &&
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'canceled'
  ) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollUrl = prediction.urls?.get || `${baseUrl}/predictions/${prediction.id}`;
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      signal,
    });
    if (!pollRes.ok) break;
    prediction = (await pollRes.json()) as typeof prediction;
  }

  if (prediction.status !== 'succeeded') {
    throw new ProviderExecutionError(prediction.error || `Replicate prediction ${prediction.status}`, {
      status: 500,
      code: 'REPLICATE_FAILED',
      retryable: true,
    });
  }

  return prediction;
}

export const replicateAdapter: AiProviderAdapter = {
  id: 'replicate',

  async testConnection(apiKey: string, config: AiProviderConfig): Promise<ProviderConnectionTestResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    if (!apiKey.trim()) {
      return {
        ok: false,
        providerId: 'replicate',
        status: 'not_configured',
        latencyMs: Date.now() - start,
        message: 'کلید API سرویس Replicate تنظیم نشده است.',
        checkedAt,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs || 15000, 15000));
    try {
      const res = await fetch(`${getBaseUrl(config)}/account`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return {
          ok: false,
          providerId: 'replicate',
          status: 'error',
          latencyMs,
          message: `Replicate خطای ${res.status} برگرداند: ${text.slice(0, 180)}`,
          checkedAt,
        };
      }

      const account = (await res.json()) as { username?: string; type?: string };
      return {
        ok: true,
        providerId: 'replicate',
        status: 'connected',
        latencyMs,
        message: `اتصال موفق به حساب Replicate (${account.username || 'تأییدشده'}).`,
        checkedAt,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        providerId: 'replicate',
        status: 'error',
        latencyMs: Date.now() - start,
        message: `خطا در اتصال به Replicate: ${msg.slice(0, 220)}`,
        checkedAt,
      };
    }
  },

  async generateImage(
    apiKey: string,
    req: ImageGenRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<ImageGenResult> {
    const numOutputs = Math.min(4, Math.max(1, Math.round(req.numberOfImages || 1)));
    const compiledPrompt = [
      req.prompt.trim(),
      req.styleInstructions?.trim() ? `Style: ${req.styleInstructions.trim()}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    const prediction = await runPrediction(
      apiKey,
      getBaseUrl(config),
      req.modelId,
      {
        prompt: compiledPrompt,
        ...(req.negativePrompt?.trim() ? { negative_prompt: req.negativePrompt.trim() } : {}),
        aspect_ratio: req.aspectRatio || '1:1',
        num_outputs: numOutputs,
      },
      signal
    );

    const rawUrls = Array.isArray(prediction.output)
      ? prediction.output.map(String).filter((u) => u.startsWith('http'))
      : typeof prediction.output === 'string' && prediction.output.startsWith('http')
      ? [prediction.output]
      : [];

    if (rawUrls.length === 0) {
      throw new ProviderExecutionError('Replicate آدرس تصویر معتبری برنگرداند.', {
        status: 502,
        code: 'EMPTY_IMAGE_RESPONSE',
        retryable: true,
      });
    }

    const images: ImageGeneratedItem[] = [];
    for (const outUrl of rawUrls) {
      const imgRes = await fetch(outUrl, { signal });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get('content-type') || 'image/webp';
      const dims = await detectImageDimensions(buf, mime.includes('png') ? 'png' : 'webp');
      images.push({
        dataBase64: buf.toString('base64'),
        mimeType: mime,
        width: dims.width,
        height: dims.height,
      });
    }

    return {
      images,
      dataBase64: images[0].dataBase64,
      mimeType: images[0].mimeType,
      width: images[0].width,
      height: images[0].height,
      modelUsed: req.modelId,
      estimatedCostUsd: Number((0.008 * images.length).toFixed(4)),
    };
  },

  async generateVideo(
    apiKey: string,
    req: VideoGenRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<VideoGenResult> {
    const prediction = await runPrediction(
      apiKey,
      getBaseUrl(config),
      req.modelId,
      {
        prompt: req.prompt,
        ...(req.referenceImageUrl ? { first_frame_image: req.referenceImageUrl } : {}),
      },
      signal
    );

    const outUrl = Array.isArray(prediction.output) ? String(prediction.output[0] || '') : String(prediction.output || '');
    if (!outUrl.startsWith('http')) {
      throw new ProviderExecutionError('Replicate آدرس ویدیوی معتبری برنگرداند.', {
        status: 502,
        code: 'EMPTY_VIDEO_RESPONSE',
        retryable: true,
      });
    }

    return {
      videoUrl: outUrl,
      mimeType: 'video/mp4',
      modelUsed: req.modelId,
      estimatedCostUsd: Number(((req.durationSec || 6) * 0.12).toFixed(4)),
    };
  },
};
