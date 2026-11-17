import crypto from 'crypto';
import { ProviderExecutionError, type AiProviderAdapter } from './adapters/base';
import { falAdapter } from './adapters/falAdapter';
import { geminiAdapter } from './adapters/geminiAdapter';
import { openaiAdapter } from './adapters/openaiAdapter';
import { replicateAdapter } from './adapters/replicateAdapter';
import { AiAdminStore, aiAdminStore } from './store';
import type {
  AiCapability,
  AiCredentialSource,
  AiModelSpec,
  AiProviderId,
  ImageGenRequest,
  ImageGenResult,
  ProviderConnectionTestResult,
  ProviderImageTestResult,
  StructuredJsonRequest,
  StructuredJsonResult,
  TtsGenRequest,
  TtsGenResult,
  VideoGenRequest,
  VideoGenResult,
} from './types';

const ADAPTERS: Record<AiProviderId, AiProviderAdapter> = {
  gemini: geminiAdapter,
  openai: openaiAdapter,
  fal: falAdapter,
  replicate: replicateAdapter,
};

export interface RouterContext {
  requestId: string;
  businessId: string;
  ownerId: string;
  preferredModelId?: string;
  isTest?: boolean;
}

export class AiRouter {
  private store: AiAdminStore;
  private modelCooldownUntil = new Map<string, number>();

  constructor(store: AiAdminStore = aiAdminStore) {
    this.store = store;
  }

  getCircuitBreakers(): Map<string, number> {
    return this.modelCooldownUntil;
  }

  async testProviderConnection(providerId: AiProviderId, overrideApiKey?: string): Promise<ProviderConnectionTestResult> {
    const adapter = ADAPTERS[providerId];
    const config = this.store.getProviderConfig(providerId);
    if (!adapter || !config) {
      throw new ProviderExecutionError(`سرویس‌دهنده «${providerId}» پشتیبانی نمی‌شود.`, {
        status: 404,
        code: 'UNKNOWN_PROVIDER',
      });
    }
    const apiKey = overrideApiKey?.trim() || this.store.resolvePlatformKey(providerId) || '';
    const result = await adapter.testConnection(apiKey, config);
    if (!overrideApiKey) {
      this.store.recordProviderTestResult(result);
    }
    return result;
  }

  async testProviderImageGeneration(
    providerId: AiProviderId,
    actorUid: string,
    requestedModelId?: string
  ): Promise<ProviderImageTestResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const adapter = ADAPTERS[providerId];
    const config = this.store.getProviderConfig(providerId);
    if (!adapter || !config || !adapter.generateImage) {
      throw new ProviderExecutionError(`سرویس‌دهنده «${providerId}» از تولید تصویر پشتیبانی نمی‌کند.`, {
        status: 400,
        code: 'IMAGE_GENERATION_NOT_SUPPORTED',
      });
    }

    const apiKey = this.store.resolvePlatformKey(providerId) || '';
    if (!apiKey) {
      const res: ProviderImageTestResult = {
        ok: false,
        providerId,
        modelId: requestedModelId || 'none',
        latencyMs: Date.now() - start,
        message: `کلید API پلتفرم برای سرویس‌دهنده «${config.name}» ثبت نشده است.`,
        errorCode: 'IMAGE_GENERATION_NOT_CONFIGURED',
        estimatedCostUsd: 0,
        checkedAt,
      };
      this.store.recordProviderImageTestResult(res);
      return res;
    }

    const imageModels = this.store
      .getModels()
      .filter(
        (m) =>
          m.providerId === providerId &&
          m.capabilities.includes('image_generation') &&
          m.availabilityStatus !== 'disabled'
      );

    const targetModel =
      imageModels.find((m) => m.modelId === requestedModelId || m.id === requestedModelId) ||
      imageModels.find((m) => m.isDefaultForCapabilities.includes('image_generation')) ||
      imageModels[0];

    if (!targetModel) {
      const res: ProviderImageTestResult = {
        ok: false,
        providerId,
        modelId: requestedModelId || 'none',
        latencyMs: Date.now() - start,
        message: `هیچ مدل فعال تولید تصویر برای «${config.name}» در رجیستری تعریف نشده است.`,
        errorCode: 'IMAGE_GENERATION_NOT_CONFIGURED',
        estimatedCostUsd: 0,
        checkedAt,
      };
      this.store.recordProviderImageTestResult(res);
      return res;
    }

    const controller = new AbortController();
    const timeout = targetModel.timeoutMs || config.timeoutMs || 45000;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const out = await adapter.generateImage(
        apiKey,
        {
          modelId: targetModel.modelId,
          prompt: 'Minimal studio geometric frosted glass cube on deep slate background, clean soft rim lighting, no text',
          aspectRatio: '1:1',
          numberOfImages: 1,
          resolution: '1K',
        },
        config,
        controller.signal
      );
      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      this.store.appendRequestLog({
        id: crypto.randomUUID(),
        requestId: `imgtest_${crypto.randomUUID()}`,
        businessId: 'platform_admin_test',
        ownerId: actorUid,
        capability: 'image_generation',
        providerId,
        modelId: out.modelUsed,
        credentialSource: 'platform',
        status: 'success',
        fallbackUsed: false,
        attemptedModels: [targetModel.id],
        latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        units: out.images.length || 1,
        estimatedCostUsd: out.estimatedCostUsd,
        isTest: true,
        createdAt: checkedAt,
      });

      const res: ProviderImageTestResult = {
        ok: true,
        providerId,
        modelId: out.modelUsed,
        latencyMs,
        message: `تولید تصویر آزمایشی با موفقیت انجام شد (${out.width}×${out.height}).`,
        width: out.width,
        height: out.height,
        mimeType: out.mimeType,
        previewDataUrl: `data:${out.mimeType};base64,${out.dataBase64}`,
        estimatedCostUsd: out.estimatedCostUsd,
        checkedAt,
      };
      this.store.recordProviderImageTestResult(res);
      return res;
    } catch (err: unknown) {
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      const errCode = err instanceof ProviderExecutionError ? err.code : 'IMAGE_TEST_FAILED';
      const errMsg = err instanceof Error ? err.message : String(err);

      this.store.appendRequestLog({
        id: crypto.randomUUID(),
        requestId: `imgtest_${crypto.randomUUID()}`,
        businessId: 'platform_admin_test',
        ownerId: actorUid,
        capability: 'image_generation',
        providerId,
        modelId: targetModel.modelId,
        credentialSource: 'platform',
        status: 'error',
        fallbackUsed: false,
        attemptedModels: [targetModel.id],
        latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        units: 0,
        estimatedCostUsd: 0,
        errorCode: errCode,
        errorMessage: errMsg.slice(0, 280),
        isTest: true,
        createdAt: checkedAt,
      });

      const res: ProviderImageTestResult = {
        ok: false,
        providerId,
        modelId: targetModel.modelId,
        latencyMs,
        message: errMsg.slice(0, 260),
        errorCode: errCode,
        estimatedCostUsd: 0,
        checkedAt,
      };
      this.store.recordProviderImageTestResult(res);
      return res;
    }
  }

  /**
   * Selects candidate models strictly matching the requested capability.
   * Never falls back a video or image request to a text-only model.
   */
  resolveCandidates(params: {
    capability: AiCapability;
    businessId: string;
    ownerId: string;
    preferredModelId?: string;
  }): Array<{
    model: AiModelSpec;
    providerPriority: number;
    apiKey: string;
    credentialSource: AiCredentialSource;
  }> {
    const policy = this.store.getPolicy();
    const bizSettings = this.store.getBusinessSettingsRecord(params.businessId);
    const effectiveMode: 'platform' | 'customer' =
      policy.credentialPolicy === 'platform_only'
        ? 'platform'
        : policy.credentialPolicy === 'customer_required'
        ? 'customer'
        : bizSettings?.credentialMode || 'platform';

    const providers = this.store.getProviders(this.modelCooldownUntil);
    const providerMap = new Map(providers.map((p) => [p.id, p]));
    const allModels = this.store.getModels();

    const matchingModels = allModels.filter(
      (m) =>
        m.capabilities.includes(params.capability) &&
        m.availabilityStatus !== 'disabled' &&
        m.availabilityStatus !== 'unavailable'
    );

    const eligible: Array<{
      model: AiModelSpec;
      providerPriority: number;
      apiKey: string;
      credentialSource: AiCredentialSource;
      score: number;
    }> = [];

    for (const model of matchingModels) {
      const provider = providerMap.get(model.providerId);
      if (!provider || !provider.enabled) continue;

      let apiKey: string | null = null;
      let credentialSource: AiCredentialSource = 'platform';

      if (effectiveMode === 'customer') {
        apiKey = this.store.resolveCustomerKey(params.businessId, params.ownerId, model.providerId);
        credentialSource = 'customer';
        if (!apiKey && policy.allowBusinessFallbackToPlatform) {
          apiKey = this.store.resolvePlatformKey(model.providerId);
          credentialSource = 'platform';
        }
      } else {
        apiKey = this.store.resolvePlatformKey(model.providerId);
        credentialSource = 'platform';
      }

      if (!apiKey) continue;

      const isExplicitPreferred =
        params.preferredModelId === model.modelId ||
        params.preferredModelId === model.id ||
        bizSettings?.preferredModels?.[params.capability] === model.id;
      const isCapabilityDefault = model.isDefaultForCapabilities.includes(params.capability);
      const isPreferredProvider = bizSettings?.preferredProviders?.[params.capability] === model.providerId;

      const score =
        (isExplicitPreferred ? -10000 : 0) +
        (isCapabilityDefault ? -1000 : 0) +
        (isPreferredProvider ? -200 : 0) +
        provider.priority * 10 +
        model.priority;

      eligible.push({
        model,
        providerPriority: provider.priority,
        apiKey,
        credentialSource,
        score,
      });
    }

    eligible.sort((a, b) => a.score - b.score);

    const now = Date.now();
    const healthy = eligible.filter((c) => (this.modelCooldownUntil.get(c.model.id) ?? 0) <= now);
    const inCooldown = eligible.filter((c) => (this.modelCooldownUntil.get(c.model.id) ?? 0) > now);

    return [...healthy, ...inCooldown].map(({ model, providerPriority, apiKey, credentialSource }) => ({
      model,
      providerPriority,
      apiKey,
      credentialSource,
    }));
  }

  private computeCandidateTimeout(model: AiModelSpec, providerTimeoutMs: number): number {
    if (model.providerId === 'gemini' && model.modelId === 'gemini-4-hydrogen') {
      return Math.min(providerTimeoutMs, 5500);
    }
    if (model.timeoutMs) {
      return Math.max(providerTimeoutMs, model.timeoutMs);
    }
    return providerTimeoutMs;
  }

  private async executeWithRouting<TResult>(params: {
    capability: AiCapability;
    ctx: RouterContext;
    runner: (
      adapter: AiProviderAdapter,
      apiKey: string,
      model: AiModelSpec,
      signal: AbortSignal
    ) => Promise<{
      result: TResult;
      inputTokens?: number;
      outputTokens?: number;
      units?: number;
      estimatedCostUsd: number;
    }>;
  }): Promise<TResult & { providerId: AiProviderId; modelUsed: string; fallbackUsed: boolean; latencyMs: number }> {
    const startTotal = Date.now();
    const candidates = this.resolveCandidates({
      capability: params.capability,
      businessId: params.ctx.businessId,
      ownerId: params.ctx.ownerId,
      preferredModelId: params.ctx.preferredModelId,
    });

    if (candidates.length === 0) {
      const bizSettings = this.store.getPublicBusinessSettings(params.ctx.businessId);
      const isImageCap =
        params.capability === 'image_generation' ||
        params.capability === 'image_editing' ||
        params.capability === 'image_variation';
      const errCode =
        bizSettings.credentialMode === 'customer'
          ? 'CUSTOMER_CREDENTIAL_MISSING'
          : isImageCap
          ? 'IMAGE_GENERATION_NOT_CONFIGURED'
          : 'NO_ELIGIBLE_PROVIDER';
      const errMsg =
        bizSettings.credentialMode === 'customer'
          ? `هیچ کلید API اختصاصی برای قابلیت «${params.capability}» در این کسب‌وکار ثبت نشده است.`
          : isImageCap
          ? 'هیچ سرویس‌دهنده یا مدل فعال تولید تصویر با کلید معتبر پیکربندی نشده است (IMAGE_GENERATION_NOT_CONFIGURED).'
          : `هیچ سرویس‌دهنده فعال و معتبری برای قابلیت «${params.capability}» پیکربندی نشده است.`;

      this.store.appendRequestLog({
        id: crypto.randomUUID(),
        requestId: params.ctx.requestId,
        businessId: params.ctx.businessId,
        ownerId: params.ctx.ownerId,
        capability: params.capability,
        providerId: 'gemini',
        modelId: 'none',
        credentialSource: bizSettings.credentialMode,
        status: 'error',
        fallbackUsed: false,
        attemptedModels: [],
        latencyMs: Date.now() - startTotal,
        inputTokens: 0,
        outputTokens: 0,
        units: 0,
        estimatedCostUsd: 0,
        errorCode: errCode,
        errorMessage: errMsg,
        isTest: params.ctx.isTest,
        createdAt: new Date().toISOString(),
      });

      throw new ProviderExecutionError(errMsg, {
        status: 503,
        code: errCode,
        retryable: false,
      });
    }

    const policy = this.store.getPolicy();
    const attemptedModels: string[] = [];
    let lastError: unknown = null;

    for (let idx = 0; idx < candidates.length; idx += 1) {
      const candidate = candidates[idx];
      const providerCfg = this.store.getProviderConfig(candidate.model.providerId)!;
      const adapter = ADAPTERS[candidate.model.providerId];
      if (!adapter) continue;

      if (idx > 0 && (!providerCfg.fallbackEnabled || !candidate.model.fallbackEligible)) {
        continue;
      }

      const maxAttempts = 1 + Math.min(2, providerCfg.maxRetries || 0);
      let attemptCount = 0;

      while (attemptCount < maxAttempts) {
        attemptCount += 1;
        attemptedModels.push(candidate.model.id);

        const timeoutMs = this.computeCandidateTimeout(candidate.model, providerCfg.timeoutMs);
        const abortController = new AbortController();
        const timer = setTimeout(() => abortController.abort(), timeoutMs);
        const callStart = Date.now();

        try {
          const out = await params.runner(adapter, candidate.apiKey, candidate.model, abortController.signal);
          clearTimeout(timer);

          const latencyMs = Date.now() - startTotal;
          const fallbackUsed = idx > 0;

          this.store.appendRequestLog({
            id: crypto.randomUUID(),
            requestId: params.ctx.requestId,
            businessId: params.ctx.businessId,
            ownerId: params.ctx.ownerId,
            capability: params.capability,
            providerId: candidate.model.providerId,
            modelId: candidate.model.modelId,
            credentialSource: candidate.credentialSource,
            status: fallbackUsed ? 'fallback_success' : 'success',
            fallbackUsed,
            attemptedModels,
            latencyMs,
            inputTokens: out.inputTokens ?? 0,
            outputTokens: out.outputTokens ?? 0,
            units: out.units ?? 1,
            estimatedCostUsd: out.estimatedCostUsd,
            isTest: params.ctx.isTest,
            createdAt: new Date().toISOString(),
          });

          return {
            ...out.result,
            providerId: candidate.model.providerId,
            modelUsed: candidate.model.modelId,
            fallbackUsed,
            latencyMs,
          };
        } catch (err: unknown) {
          clearTimeout(timer);
          lastError = err;
          const status = err instanceof ProviderExecutionError ? err.status : 500;
          const msg = err instanceof Error ? err.message : String(err);
          const retryable =
            err instanceof ProviderExecutionError
              ? err.retryable
              : status === 503 || status === 429 || msg.includes('abort');

          const callElapsed = Date.now() - callStart;
          console.warn(
            `AI attempt failed [${candidate.model.id}] attempt=${attemptCount}/${maxAttempts} status=${status} elapsed=${callElapsed}ms`
          );

          const hasMoreFallbacks = idx < candidates.length - 1;
          if (!retryable) {
            break;
          }
          if (status === 503 || msg.includes('abort') || msg.includes('UNAVAILABLE')) {
            this.modelCooldownUntil.set(candidate.model.id, Date.now() + policy.defaultCooldownMs);
            if (hasMoreFallbacks) break;
          }
          if (attemptCount < maxAttempts) {
            await new Promise((r) => setTimeout(r, 350 * attemptCount));
          }
        }
      }
    }

    const finalStatus = lastError instanceof ProviderExecutionError ? lastError.status : 500;
    const finalCode = lastError instanceof ProviderExecutionError ? lastError.code : 'ALL_MODELS_UNAVAILABLE';
    const finalMessage = lastError instanceof Error ? lastError.message : 'All candidate models failed';

    this.store.appendRequestLog({
      id: crypto.randomUUID(),
      requestId: params.ctx.requestId,
      businessId: params.ctx.businessId,
      ownerId: params.ctx.ownerId,
      capability: params.capability,
      providerId: candidates[0].model.providerId,
      modelId: candidates[0].model.modelId,
      credentialSource: candidates[0].credentialSource,
      status: 'error',
      fallbackUsed: attemptedModels.length > 1,
      attemptedModels,
      latencyMs: Date.now() - startTotal,
      inputTokens: 0,
      outputTokens: 0,
      units: 0,
      estimatedCostUsd: 0,
      errorCode: finalCode,
      errorMessage: finalMessage.slice(0, 280),
      isTest: params.ctx.isTest,
      createdAt: new Date().toISOString(),
    });

    if (lastError instanceof ProviderExecutionError) {
      throw lastError;
    }
    throw new ProviderExecutionError(finalMessage, {
      status: finalStatus,
      code: finalCode,
      retryable: false,
    });
  }

  async generateStructuredJson(
    ctx: RouterContext,
    req: Omit<StructuredJsonRequest, 'modelId'>
  ): Promise<
    StructuredJsonResult & { providerId: AiProviderId; fallbackUsed: boolean; latencyMs: number }
  > {
    return this.executeWithRouting<StructuredJsonResult>({
      capability: 'structured_json',
      ctx,
      runner: async (adapter, apiKey, model, signal) => {
        if (!adapter.generateStructuredJson) {
          throw new ProviderExecutionError(`آداپتر ${adapter.id} از خروجی JSON پشتیبانی نمی‌کند.`, {
            status: 400,
            code: 'CAPABILITY_NOT_IMPLEMENTED',
          });
        }
        const cfg = this.store.getProviderConfig(model.providerId)!;
        const result = await adapter.generateStructuredJson(
          apiKey,
          { ...req, modelId: model.modelId },
          cfg,
          signal
        );
        return {
          result,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUsd: result.estimatedCostUsd,
        };
      },
    });
  }

  async generateImage(
    ctx: RouterContext,
    req: Omit<ImageGenRequest, 'modelId'>
  ): Promise<ImageGenResult & { providerId: AiProviderId; fallbackUsed: boolean; latencyMs: number }> {
    const hasReference = Boolean(req.referenceImageBase64 || (req.referenceImages && req.referenceImages.length > 0));
    const capability: AiCapability = req.isVariation
      ? 'image_variation'
      : hasReference
      ? 'image_editing'
      : 'image_generation';

    return this.executeWithRouting<ImageGenResult>({
      capability,
      ctx,
      runner: async (adapter, apiKey, model, signal) => {
        if (!adapter.generateImage) {
          throw new ProviderExecutionError(`آداپتر ${adapter.id} از تولید تصویر پشتیبانی نمی‌کند.`, {
            status: 400,
            code: 'CAPABILITY_NOT_IMPLEMENTED',
          });
        }
        const cfg = this.store.getProviderConfig(model.providerId)!;
        const result = await adapter.generateImage(apiKey, { ...req, modelId: model.modelId }, cfg, signal);
        return {
          result,
          units: result.images.length || 1,
          estimatedCostUsd: result.estimatedCostUsd,
        };
      },
    });
  }

  async generateVideo(
    ctx: RouterContext,
    req: Omit<VideoGenRequest, 'modelId'>
  ): Promise<VideoGenResult & { providerId: AiProviderId; fallbackUsed: boolean; latencyMs: number }> {
    return this.executeWithRouting<VideoGenResult>({
      capability: 'video_generation',
      ctx,
      runner: async (adapter, apiKey, model, signal) => {
        if (!adapter.generateVideo) {
          throw new ProviderExecutionError(`آداپتر ${adapter.id} از تولید ویدیو پشتیبانی نمی‌کند.`, {
            status: 400,
            code: 'CAPABILITY_NOT_IMPLEMENTED',
          });
        }
        const cfg = this.store.getProviderConfig(model.providerId)!;
        const result = await adapter.generateVideo(apiKey, { ...req, modelId: model.modelId }, cfg, signal);
        return {
          result,
          units: req.durationSec || 5,
          estimatedCostUsd: result.estimatedCostUsd,
        };
      },
    });
  }

  async generateSpeech(
    ctx: RouterContext,
    req: Omit<TtsGenRequest, 'modelId'>
  ): Promise<TtsGenResult & { providerId: AiProviderId; fallbackUsed: boolean; latencyMs: number }> {
    return this.executeWithRouting<TtsGenResult>({
      capability: 'text_to_speech',
      ctx,
      runner: async (adapter, apiKey, model, signal) => {
        if (!adapter.generateSpeech) {
          throw new ProviderExecutionError(`آداپتر ${adapter.id} از تبدیل متن به گفتار پشتیبانی نمی‌کند.`, {
            status: 400,
            code: 'CAPABILITY_NOT_IMPLEMENTED',
          });
        }
        const cfg = this.store.getProviderConfig(model.providerId)!;
        const result = await adapter.generateSpeech(apiKey, { ...req, modelId: model.modelId }, cfg, signal);
        return {
          result,
          units: req.text.length,
          estimatedCostUsd: result.estimatedCostUsd,
        };
      },
    });
  }
}

export const aiRouter = new AiRouter(aiAdminStore);
