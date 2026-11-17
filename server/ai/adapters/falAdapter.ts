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

function mapFalImageSize(aspectRatio?: string): string | { width: number; height: number } {
  if (aspectRatio === '9:16') return 'portrait_16_9';
  if (aspectRatio === '4:5') return { width: 1080, height: 1350 };
  if (aspectRatio === '3:4') return 'portrait_4_3';
  if (aspectRatio === '4:3') return 'landscape_4_3';
  if (aspectRatio === '16:9') return 'landscape_16_9';
  return 'square_hd';
}

export const falAdapter: AiProviderAdapter = {
  id: 'fal',

  async testConnection(apiKey: string, config: AiProviderConfig): Promise<ProviderConnectionTestResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    if (!apiKey.trim()) {
      return {
        ok: false,
        providerId: 'fal',
        status: 'not_configured',
        latencyMs: Date.now() - start,
        message: 'کلید API سرویس fal.ai تنظیم نشده است.',
        checkedAt,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs || 15000, 15000));
    try {
      const res = await fetch('https://api.fal.ai/v1/models?limit=5', {
        method: 'GET',
        headers: {
          Authorization: `Key ${apiKey.trim()}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return {
          ok: false,
          providerId: 'fal',
          status: 'error',
          latencyMs,
          message: `fal.ai خطای ${res.status} برگرداند: ${text.slice(0, 180)}`,
          checkedAt,
        };
      }

      const data = (await res.json().catch(() => ({}))) as { models?: Array<{ endpoint_id?: string }> };
      const detectedModels = (data.models ?? [])
        .map((m) => m.endpoint_id)
        .filter((id): id is string => Boolean(id));

      return {
        ok: true,
        providerId: 'fal',
        status: 'connected',
        latencyMs,
        message: 'اتصال به fal.ai با موفقیت تأیید شد.',
        detectedModels,
        checkedAt,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        providerId: 'fal',
        status: 'error',
        latencyMs: Date.now() - start,
        message: `خطا در اتصال به fal.ai: ${msg.slice(0, 220)}`,
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
    const baseUrl = (config.baseUrl || 'https://fal.run').replace(/\/+$/, '');
    const imageSize = mapFalImageSize(req.aspectRatio);
    const numImages = Math.min(4, Math.max(1, Math.round(req.numberOfImages || 1)));
    const compiledPrompt = [
      req.prompt.trim(),
      req.styleInstructions?.trim() ? `Style: ${req.styleInstructions.trim()}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    const res = await fetch(`${baseUrl}/${req.modelId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        prompt: compiledPrompt,
        ...(req.negativePrompt?.trim() ? { negative_prompt: req.negativePrompt.trim() } : {}),
        image_size: imageSize,
        num_images: numImages,
      }),
      signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new ProviderExecutionError(`fal.ai HTTP ${res.status}: ${txt.slice(0, 180)}`, {
        status: res.status,
        code: res.status === 429 ? 'QUOTA_EXCEEDED' : 'FAL_IMAGE_ERROR',
        retryable: res.status === 429 || res.status >= 500,
      });
    }

    const json = (await res.json()) as {
      images?: Array<{ url?: string; content_type?: string; width?: number; height?: number }>;
    };
    const items = (json.images ?? []).filter((x) => Boolean(x.url));
    if (items.length === 0) {
      throw new ProviderExecutionError('fal.ai تصویر معتبری برنگرداند.', {
        status: 502,
        code: 'EMPTY_IMAGE_RESPONSE',
        retryable: true,
      });
    }

    const images: ImageGeneratedItem[] = [];
    for (const item of items) {
      const imgRes = await fetch(item.url!, { signal });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = item.content_type || imgRes.headers.get('content-type') || 'image/jpeg';
      const dims = await detectImageDimensions(buf, mime.includes('png') ? 'png' : 'jpg');
      images.push({
        dataBase64: buf.toString('base64'),
        mimeType: mime,
        width: item.width || dims.width,
        height: item.height || dims.height,
      });
    }

    return {
      images,
      dataBase64: images[0].dataBase64,
      mimeType: images[0].mimeType,
      width: images[0].width,
      height: images[0].height,
      modelUsed: req.modelId,
      estimatedCostUsd: Number((0.006 * images.length).toFixed(4)),
    };
  },

  async generateVideo(
    apiKey: string,
    req: VideoGenRequest,
    _config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<VideoGenResult> {
    const queueRes = await fetch(`https://queue.fal.run/${req.modelId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio || '9:16',
        duration: String(req.durationSec || 5),
        ...(req.referenceImageUrl ? { image_url: req.referenceImageUrl } : {}),
      }),
      signal,
    });

    if (!queueRes.ok) {
      const txt = await queueRes.text().catch(() => '');
      throw new ProviderExecutionError(`fal.ai Video HTTP ${queueRes.status}: ${txt.slice(0, 180)}`, {
        status: queueRes.status,
        code: 'FAL_VIDEO_ERROR',
        retryable: queueRes.status === 429 || queueRes.status >= 500,
      });
    }

    const queued = (await queueRes.json()) as { status_url?: string; response_url?: string; video?: { url?: string } };
    if (queued.video?.url) {
      return {
        videoUrl: queued.video.url,
        mimeType: 'video/mp4',
        modelUsed: req.modelId,
        estimatedCostUsd: Number(((req.durationSec || 5) * 0.14).toFixed(4)),
      };
    }

    if (!queued.status_url || !queued.response_url) {
      throw new ProviderExecutionError('پاسخ صف ویدیوی fal.ai ناقص است.', {
        status: 502,
        code: 'FAL_QUEUE_ERROR',
        retryable: true,
      });
    }

    while (!signal.aborted) {
      await new Promise((r) => setTimeout(r, 2500));
      const statusRes = await fetch(queued.status_url, {
        headers: { Authorization: `Key ${apiKey.trim()}` },
        signal,
      });
      if (!statusRes.ok) continue;
      const statusData = (await statusRes.json()) as { status?: string };
      if (statusData.status === 'COMPLETED') {
        const finalRes = await fetch(queued.response_url, {
          headers: { Authorization: `Key ${apiKey.trim()}` },
          signal,
        });
        const finalJson = (await finalRes.json()) as { video?: { url?: string } };
        if (finalJson.video?.url) {
          return {
            videoUrl: finalJson.video.url,
            mimeType: 'video/mp4',
            modelUsed: req.modelId,
            estimatedCostUsd: Number(((req.durationSec || 5) * 0.14).toFixed(4)),
          };
        }
        break;
      }
      if (statusData.status === 'FAILED') {
        throw new ProviderExecutionError('پردازش ویدیو در fal.ai ناموفق بود.', {
          status: 500,
          code: 'FAL_VIDEO_FAILED',
          retryable: true,
        });
      }
    }

    throw new ProviderExecutionError('تولید ویدیو در fal.ai به پایان نرسید.', {
      status: 504,
      code: 'TIMEOUT',
      retryable: true,
    });
  },
};
