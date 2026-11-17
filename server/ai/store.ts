import fs from 'fs';
import path from 'path';
import { decryptSecret, encryptSecret, maskSecret } from './crypto';
import { createDefaultModels, createDefaultProviders, DEFAULT_ROUTING_POLICY } from './defaults';
import type {
  AiCapability,
  AiModelSpec,
  AiProviderConfig,
  AiProviderId,
  AiRequestLogRecord,
  AiRoutingPolicy,
  BusinessAiSettingsRecord,
  EncryptedSecretBlob,
  ProviderConnectionTestResult,
  ProviderImageTestResult,
  PublicAiProviderView,
  PublicBusinessAiSettingsView,
} from './types';

interface PersistedAiState {
  providers: AiProviderConfig[];
  platformKeys: Partial<Record<AiProviderId, EncryptedSecretBlob>>;
  models: AiModelSpec[];
  policy: AiRoutingPolicy;
  businessSettings: Record<string, BusinessAiSettingsRecord>;
  requestLogs: AiRequestLogRecord[];
}

const MAX_REQUEST_LOGS = 400;

export class AiAdminStore {
  private filePath: string;
  private state: PersistedAiState;

  constructor(customFilePath?: string) {
    this.filePath = customFilePath || path.resolve(process.cwd(), 'data', 'ai-admin-state.json');
    this.state = this.loadOrInit();
  }

  private loadOrInit(): PersistedAiState {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedAiState>;
        const defaultsProviders = createDefaultProviders();
        const mergedProviders = defaultsProviders.map((def) => {
          const saved = parsed.providers?.find((p) => p.id === def.id);
          if (!saved) return def;
          return {
            ...def,
            ...saved,
            timeoutMs: Math.max(saved.timeoutMs || 0, def.timeoutMs),
          };
        });

        const defaultModels = createDefaultModels();
        const savedModels = parsed.models ?? [];
        const defaultMap = new Map(defaultModels.map((dm) => [dm.id, dm]));
        const mergedModels = savedModels.map((sm) => {
          const dm = defaultMap.get(sm.id);
          if (!dm) return sm;
          const extraCaps = dm.capabilities.filter((c) => !sm.capabilities.includes(c));
          return {
            ...dm,
            ...sm,
            capabilities: extraCaps.length > 0 ? [...sm.capabilities, ...extraCaps] : sm.capabilities,
            supportedAspectRatios: sm.supportedAspectRatios ?? dm.supportedAspectRatios,
            resolutionOptions: sm.resolutionOptions ?? dm.resolutionOptions,
            supportsNegativePrompt: sm.supportsNegativePrompt ?? dm.supportsNegativePrompt,
            supportsReferenceImage: sm.supportsReferenceImage ?? dm.supportsReferenceImage,
            supportsVariation: sm.supportsVariation ?? dm.supportsVariation,
            timeoutMs: sm.timeoutMs ?? dm.timeoutMs,
          };
        });
        for (const dm of defaultModels) {
          if (!mergedModels.some((m) => m.id === dm.id)) {
            mergedModels.push(dm);
          }
        }

        return {
          providers: mergedProviders,
          platformKeys: parsed.platformKeys ?? {},
          models: mergedModels,
          policy: { ...DEFAULT_ROUTING_POLICY, ...(parsed.policy ?? {}) },
          businessSettings: parsed.businessSettings ?? {},
          requestLogs: Array.isArray(parsed.requestLogs) ? parsed.requestLogs.slice(0, MAX_REQUEST_LOGS) : [],
        };
      }
    } catch (err) {
      console.warn('Could not load AI admin store, reinitializing defaults:', err);
    }

    const initial: PersistedAiState = {
      providers: createDefaultProviders(),
      platformKeys: {},
      models: createDefaultModels(),
      policy: { ...DEFAULT_ROUTING_POLICY },
      businessSettings: {},
      requestLogs: [],
    };
    this.persist(initial);
    return initial;
  }

  private persist(nextState: PersistedAiState = this.state) {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(nextState, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist AI admin state:', err);
    }
  }

  getProviders(circuitBreakers?: Map<string, number>): PublicAiProviderView[] {
    const now = Date.now();
    return [...this.state.providers]
      .sort((a, b) => a.priority - b.priority)
      .map((p) => {
        const stored = this.state.platformKeys[p.id];
        const envKey = process.env[p.credentialEnvVar]?.trim() || '';
        const hasStoredPlatformKey = Boolean(stored);
        const hasEnvPlatformKey = Boolean(envKey);
        const hasCredential = hasStoredPlatformKey || hasEnvPlatformKey;
        const maskedCredential = stored
          ? stored.maskedPreview
          : envKey
          ? maskSecret(envKey)
          : null;

        let maxCircuit = 0;
        if (circuitBreakers) {
          for (const m of this.state.models) {
            if (m.providerId === p.id) {
              const until = circuitBreakers.get(m.id) ?? 0;
              if (until > now && until > maxCircuit) {
                maxCircuit = until;
              }
            }
          }
        }

        return {
          ...p,
          hasStoredPlatformKey,
          hasEnvPlatformKey,
          hasCredential,
          maskedCredential,
          connectionStatus:
            !hasCredential && p.connectionStatus !== 'error' ? 'not_configured' : p.connectionStatus,
          circuitOpenUntil: maxCircuit > now ? maxCircuit : undefined,
        };
      });
  }

  getProviderConfig(providerId: AiProviderId): AiProviderConfig | undefined {
    return this.state.providers.find((p) => p.id === providerId);
  }

  upsertProvider(
    providerId: AiProviderId,
    updates: Partial<Pick<AiProviderConfig, 'name' | 'enabled' | 'priority' | 'timeoutMs' | 'maxRetries' | 'fallbackEnabled' | 'baseUrl'>>
  ): PublicAiProviderView {
    const idx = this.state.providers.findIndex((p) => p.id === providerId);
    if (idx === -1) {
      throw new Error(`UNKNOWN_PROVIDER:${providerId}`);
    }
    const current = this.state.providers[idx];
    const next: AiProviderConfig = {
      ...current,
      name: typeof updates.name === 'string' && updates.name.trim() ? updates.name.trim() : current.name,
      enabled: typeof updates.enabled === 'boolean' ? updates.enabled : current.enabled,
      priority:
        typeof updates.priority === 'number' && Number.isFinite(updates.priority)
          ? Math.max(1, Math.min(100, Math.round(updates.priority)))
          : current.priority,
      timeoutMs:
        typeof updates.timeoutMs === 'number' && Number.isFinite(updates.timeoutMs)
          ? Math.max(2000, Math.min(180000, Math.round(updates.timeoutMs)))
          : current.timeoutMs,
      maxRetries:
        typeof updates.maxRetries === 'number' && Number.isFinite(updates.maxRetries)
          ? Math.max(0, Math.min(4, Math.round(updates.maxRetries)))
          : current.maxRetries,
      fallbackEnabled:
        typeof updates.fallbackEnabled === 'boolean' ? updates.fallbackEnabled : current.fallbackEnabled,
      baseUrl: typeof updates.baseUrl === 'string' && updates.baseUrl.trim() ? updates.baseUrl.trim() : current.baseUrl,
      updatedAt: new Date().toISOString(),
    };
    this.state.providers[idx] = next;
    this.persist();
    return this.getProviders().find((p) => p.id === providerId)!;
  }

  setPlatformCredential(providerId: AiProviderId, rawApiKey: string): PublicAiProviderView {
    const idx = this.state.providers.findIndex((p) => p.id === providerId);
    if (idx === -1) {
      throw new Error(`UNKNOWN_PROVIDER:${providerId}`);
    }
    this.state.platformKeys[providerId] = encryptSecret(rawApiKey);
    this.state.providers[idx] = {
      ...this.state.providers[idx],
      connectionStatus: 'untested',
      lastTestError: undefined,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.getProviders().find((p) => p.id === providerId)!;
  }

  deletePlatformCredential(providerId: AiProviderId): PublicAiProviderView {
    delete this.state.platformKeys[providerId];
    const idx = this.state.providers.findIndex((p) => p.id === providerId);
    if (idx !== -1) {
      const hasEnv = Boolean(process.env[this.state.providers[idx].credentialEnvVar]?.trim());
      this.state.providers[idx] = {
        ...this.state.providers[idx],
        connectionStatus: hasEnv ? 'untested' : 'not_configured',
        lastTestError: undefined,
        updatedAt: new Date().toISOString(),
      };
    }
    this.persist();
    return this.getProviders().find((p) => p.id === providerId)!;
  }

  resolvePlatformKey(providerId: AiProviderId): string | null {
    const stored = this.state.platformKeys[providerId];
    if (stored) {
      try {
        return decryptSecret(stored);
      } catch {
        return null;
      }
    }
    const cfg = this.getProviderConfig(providerId);
    if (!cfg) return null;
    const envVal = process.env[cfg.credentialEnvVar]?.trim();
    return envVal || null;
  }

  recordProviderTestResult(result: ProviderConnectionTestResult): PublicAiProviderView {
    const idx = this.state.providers.findIndex((p) => p.id === result.providerId);
    if (idx !== -1) {
      this.state.providers[idx] = {
        ...this.state.providers[idx],
        connectionStatus: result.status,
        lastTestedAt: result.checkedAt,
        lastLatencyMs: result.latencyMs,
        lastTestError: result.ok ? undefined : result.message,
        detectedModels: result.detectedModels,
        updatedAt: result.checkedAt,
      };
      this.persist();
    }
    return this.getProviders().find((p) => p.id === result.providerId)!;
  }

  recordProviderImageTestResult(result: ProviderImageTestResult): PublicAiProviderView {
    const idx = this.state.providers.findIndex((p) => p.id === result.providerId);
    if (idx !== -1) {
      this.state.providers[idx] = {
        ...this.state.providers[idx],
        lastImageTestAt: result.checkedAt,
        lastImageTestOk: result.ok,
        lastImageTestModel: result.modelId,
        lastImageTestError: result.ok ? undefined : result.message,
        updatedAt: result.checkedAt,
      };
      this.persist();
    }
    return this.getProviders().find((p) => p.id === result.providerId)!;
  }

  getModels(): AiModelSpec[] {
    return [...this.state.models].sort((a, b) => a.priority - b.priority);
  }

  upsertModel(spec: AiModelSpec): AiModelSpec {
    const id = spec.id || `${spec.providerId}:${spec.modelId}`;
    const next: AiModelSpec = {
      ...spec,
      id,
      priority: Math.max(1, Math.min(200, Math.round(spec.priority || 10))),
    };

    // If this model is marked default for any capability, remove default flag for that capability from siblings
    if (next.isDefaultForCapabilities.length > 0) {
      for (let i = 0; i < this.state.models.length; i += 1) {
        if (this.state.models[i].id !== id) {
          this.state.models[i] = {
            ...this.state.models[i],
            isDefaultForCapabilities: this.state.models[i].isDefaultForCapabilities.filter(
              (cap) => !next.isDefaultForCapabilities.includes(cap)
            ),
          };
        }
      }
    }

    const idx = this.state.models.findIndex((m) => m.id === id);
    if (idx === -1) {
      this.state.models.push(next);
    } else {
      this.state.models[idx] = next;
    }
    this.persist();
    return next;
  }

  getPolicy(): AiRoutingPolicy {
    return { ...this.state.policy };
  }

  updatePolicy(updates: Partial<AiRoutingPolicy>): AiRoutingPolicy {
    this.state.policy = {
      ...this.state.policy,
      ...(updates.credentialPolicy ? { credentialPolicy: updates.credentialPolicy } : {}),
      ...(typeof updates.allowBusinessFallbackToPlatform === 'boolean'
        ? { allowBusinessFallbackToPlatform: updates.allowBusinessFallbackToPlatform }
        : {}),
      ...(typeof updates.defaultCooldownMs === 'number' && Number.isFinite(updates.defaultCooldownMs)
        ? { defaultCooldownMs: Math.max(10_000, Math.min(600_000, Math.round(updates.defaultCooldownMs))) }
        : {}),
    };
    this.persist();
    return this.getPolicy();
  }

  getBusinessSettingsRecord(businessId: string): BusinessAiSettingsRecord | undefined {
    return this.state.businessSettings[businessId];
  }

  getPublicBusinessSettings(businessId: string): PublicBusinessAiSettingsView {
    const rec = this.state.businessSettings[businessId];
    const providerIds: AiProviderId[] = ['gemini', 'openai', 'fal', 'replicate'];
    const customerKeys = {} as PublicBusinessAiSettingsView['customerKeys'];
    for (const pid of providerIds) {
      const blob = rec?.encryptedCustomerKeys?.[pid];
      customerKeys[pid] = {
        configured: Boolean(blob),
        maskedPreview: blob?.maskedPreview ?? null,
        updatedAt: blob?.updatedAt,
      };
    }

    const effectiveMode =
      this.state.policy.credentialPolicy === 'platform_only'
        ? 'platform'
        : this.state.policy.credentialPolicy === 'customer_required'
        ? 'customer'
        : rec?.credentialMode || 'platform';

    return {
      businessId,
      credentialMode: effectiveMode,
      platformPolicy: this.state.policy.credentialPolicy,
      preferredProviders: rec?.preferredProviders ?? {},
      preferredModels: rec?.preferredModels ?? {},
      customerKeys,
      updatedAt: rec?.updatedAt || new Date().toISOString(),
    };
  }

  updateBusinessSettings(params: {
    businessId: string;
    ownerId: string;
    credentialMode?: 'platform' | 'customer';
    preferredProviders?: Partial<Record<AiCapability, AiProviderId>>;
    preferredModels?: Partial<Record<AiCapability, string>>;
    setCustomerKey?: { providerId: AiProviderId; apiKey: string };
    removeCustomerKeyProvider?: AiProviderId;
  }): PublicBusinessAiSettingsView {
    const existing = this.state.businessSettings[params.businessId] ?? {
      businessId: params.businessId,
      ownerId: params.ownerId,
      credentialMode: 'platform',
      preferredProviders: {},
      preferredModels: {},
      encryptedCustomerKeys: {},
      updatedAt: new Date().toISOString(),
    };

    if (existing.ownerId && existing.ownerId !== params.ownerId) {
      throw new Error('CROSS_TENANT_ACCESS_DENIED');
    }

    const nextEncrypted = { ...existing.encryptedCustomerKeys };
    if (params.setCustomerKey?.apiKey?.trim()) {
      nextEncrypted[params.setCustomerKey.providerId] = encryptSecret(params.setCustomerKey.apiKey);
    }
    if (params.removeCustomerKeyProvider) {
      delete nextEncrypted[params.removeCustomerKeyProvider];
    }

    const next: BusinessAiSettingsRecord = {
      ...existing,
      ownerId: params.ownerId,
      credentialMode: params.credentialMode ?? existing.credentialMode,
      preferredProviders: params.preferredProviders ?? existing.preferredProviders,
      preferredModels: params.preferredModels ?? existing.preferredModels,
      encryptedCustomerKeys: nextEncrypted,
      updatedAt: new Date().toISOString(),
    };

    this.state.businessSettings[params.businessId] = next;
    this.persist();
    return this.getPublicBusinessSettings(params.businessId);
  }

  resolveCustomerKey(businessId: string, ownerId: string, providerId: AiProviderId): string | null {
    const rec = this.state.businessSettings[businessId];
    if (!rec || rec.ownerId !== ownerId) return null;
    const blob = rec.encryptedCustomerKeys?.[providerId];
    if (!blob) return null;
    try {
      return decryptSecret(blob);
    } catch {
      return null;
    }
  }

  appendRequestLog(log: AiRequestLogRecord) {
    this.state.requestLogs.unshift(log);
    if (this.state.requestLogs.length > MAX_REQUEST_LOGS) {
      this.state.requestLogs.length = MAX_REQUEST_LOGS;
    }
    this.persist();
  }

  getRequestLogs(filter?: { businessId?: string; limit?: number }): AiRequestLogRecord[] {
    let items = this.state.requestLogs;
    if (filter?.businessId) {
      items = items.filter((l) => l.businessId === filter.businessId);
    }
    return items.slice(0, filter?.limit ?? 100);
  }

  getTelemetrySummary(businessId?: string) {
    const logs = businessId
      ? this.state.requestLogs.filter((l) => l.businessId === businessId)
      : this.state.requestLogs;

    let totalRequests = 0;
    let successCount = 0;
    let fallbackCount = 0;
    let errorCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalEstimatedCostUsd = 0;
    let latencySum = 0;

    const byProvider: Record<
      string,
      {
        requests: number;
        errors: number;
        fallbacks: number;
        estimatedCostUsd: number;
        avgLatencyMs: number;
        latencySum: number;
      }
    > = {};

    for (const log of logs) {
      totalRequests += 1;
      if (log.status === 'error') errorCount += 1;
      else successCount += 1;
      if (log.fallbackUsed) fallbackCount += 1;
      totalInputTokens += log.inputTokens || 0;
      totalOutputTokens += log.outputTokens || 0;
      totalEstimatedCostUsd += log.estimatedCostUsd || 0;
      latencySum += log.latencyMs || 0;

      if (!byProvider[log.providerId]) {
        byProvider[log.providerId] = {
          requests: 0,
          errors: 0,
          fallbacks: 0,
          estimatedCostUsd: 0,
          avgLatencyMs: 0,
          latencySum: 0,
        };
      }
      const p = byProvider[log.providerId];
      p.requests += 1;
      if (log.status === 'error') p.errors += 1;
      if (log.fallbackUsed) p.fallbacks += 1;
      p.estimatedCostUsd += log.estimatedCostUsd || 0;
      p.latencySum += log.latencyMs || 0;
    }

    for (const key of Object.keys(byProvider)) {
      const p = byProvider[key];
      p.avgLatencyMs = p.requests > 0 ? Math.round(p.latencySum / p.requests) : 0;
      p.estimatedCostUsd = Number(p.estimatedCostUsd.toFixed(6));
    }

    return {
      totalRequests,
      successCount,
      fallbackCount,
      errorCount,
      totalInputTokens,
      totalOutputTokens,
      totalEstimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(6)),
      avgLatencyMs: totalRequests > 0 ? Math.round(latencySum / totalRequests) : 0,
      byProvider,
    };
  }
}

export const aiAdminStore = new AiAdminStore();
