import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Cpu,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { formatDigits, formatJalaliDateTime, formatNumber } from '../lib/localization';
import {
  fetchAdminAiOverview,
  removeAdminProviderCredential,
  saveAdminProviderCredential,
  testAdminProviderConnection,
  testAdminProviderImageGeneration,
  updateAdminAiPolicy,
  updateAdminAiProvider,
  upsertAdminAiModel,
  type AdminAiOverviewResponse,
  type ProviderImageTestResponse,
} from '../services/apiClient';
import type {
  AiAvailabilityStatus,
  AiCapability,
  AiModelSpecView,
  AiPlatformCredentialPolicy,
  AiProviderId,
  AiProviderView,
  Business,
} from '../types/domain';
import { ErrorState, LoadingState } from '../components/ui/Primitives';

type AdminTab = 'providers' | 'models' | 'telemetry';

const CAPABILITY_LABELS: Record<AiCapability, string> = {
  text_generation: 'تولید متن',
  structured_json: 'خروجی ساختاریافته JSON',
  image_generation: 'تولید تصویر',
  image_editing: 'ویرایش تصویر',
  image_variation: 'تنوع تصویر (Variation)',
  image_understanding: 'درک تصویر',
  video_generation: 'تولید ویدیو',
  text_to_speech: 'تبدیل متن به گفتار (TTS)',
  audio_generation: 'تولید صوت و موسیقی',
  media_understanding: 'درک رسانه چندوجهی',
  embeddings: 'بردارسازی (Embeddings)',
};

const CONNECTION_LABELS: Record<string, { label: string; colorClass: string }> = {
  connected: { label: 'متصل', colorClass: 'text-[#22C55E]' },
  error: { label: 'خطای اتصال', colorClass: 'text-[#EF4444]' },
  untested: { label: 'تست‌نشده', colorClass: 'text-[#F59E0B]' },
  not_configured: { label: 'کلید ثبت نشده', colorClass: 'text-[#94A3B8]' },
};

export function AiProvidersAdminPage({ business }: { business: Business }) {
  const { locale } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [tab, setTab] = useState<AdminTab>('providers');
  const [data, setData] = useState<AdminAiOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-provider interactive drafts
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [providerEdits, setProviderEdits] = useState<
    Record<string, { priority: number; timeoutMs: number; maxRetries: number; baseUrl: string }>
  >({});
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testingImageProvider, setTestingImageProvider] = useState<string | null>(null);
  const [imageTestResults, setImageTestResults] = useState<Record<string, ProviderImageTestResponse['result']>>({});

  // Model registry filter & add modal
  const [capabilityFilter, setCapabilityFilter] = useState<'all' | AiCapability>('all');
  const [showAddModel, setShowAddModel] = useState(false);
  const [newModel, setNewModel] = useState<{
    providerId: AiProviderId;
    modelId: string;
    displayName: string;
    capabilities: AiCapability[];
    maxInputSize: string;
    priority: number;
  }>({
    providerId: 'openai',
    modelId: '',
    displayName: '',
    capabilities: ['text_generation', 'structured_json'],
    maxInputSize: '128K tokens',
    priority: 15,
  });

  // Policy edits
  const [policyBusy, setPolicyBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminAiOverview();
      setData(res);
      const editMap: Record<string, { priority: number; timeoutMs: number; maxRetries: number; baseUrl: string }> = {};
      for (const p of res.providers) {
        editMap[p.id] = {
          priority: p.priority,
          timeoutMs: p.timeoutMs,
          maxRetries: p.maxRetries,
          baseUrl: p.baseUrl,
        };
      }
      setProviderEdits(editMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت اطلاعات مدیریت سرویس‌دهنده‌های هوش مصنوعی');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const filteredModels = useMemo(() => {
    if (!data) return [];
    if (capabilityFilter === 'all') return data.models;
    return data.models.filter((m) => m.capabilities.includes(capabilityFilter));
  }, [data, capabilityFilter]);

  const handleToggleProvider = async (provider: AiProviderView, field: 'enabled' | 'fallbackEnabled') => {
    setBusyProvider(provider.id);
    setError(null);
    setNotice(null);
    try {
      await updateAdminAiProvider({
        id: provider.id,
        [field]: !provider[field],
      });
      await loadOverview();
      setNotice(`تنظیمات سرویس‌دهنده «${provider.name}» به‌روزرسانی شد.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در به‌روزرسانی سرویس‌دهنده');
    } finally {
      setBusyProvider(null);
    }
  };

  const handleSaveProviderParams = async (provider: AiProviderView) => {
    const draft = providerEdits[provider.id];
    if (!draft) return;
    setBusyProvider(provider.id);
    setError(null);
    setNotice(null);
    try {
      await updateAdminAiProvider({
        id: provider.id,
        priority: Number(draft.priority),
        timeoutMs: Number(draft.timeoutMs),
        maxRetries: Number(draft.maxRetries),
        baseUrl: draft.baseUrl.trim(),
      });
      await loadOverview();
      setNotice(`پارامترهای اجرایی «${provider.name}» ذخیره شد.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره پارامترهای سرویس‌دهنده');
    } finally {
      setBusyProvider(null);
    }
  };

  const handleSaveCredential = async (providerId: AiProviderId) => {
    const rawKey = (keyDrafts[providerId] || '').trim();
    if (rawKey.length < 8) {
      setError('لطفاً یک کلید API معتبر (حداقل ۸ کاراکتر) وارد کنید.');
      return;
    }
    setBusyProvider(providerId);
    setError(null);
    setNotice(null);
    try {
      const res = await saveAdminProviderCredential(providerId, rawKey);
      setKeyDrafts((prev) => ({ ...prev, [providerId]: '' }));
      await loadOverview();
      setNotice(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره کلید API');
    } finally {
      setBusyProvider(null);
    }
  };

  const handleRemoveCredential = async (providerId: AiProviderId) => {
    setBusyProvider(providerId);
    setError(null);
    setNotice(null);
    try {
      const res = await removeAdminProviderCredential(providerId);
      await loadOverview();
      setNotice(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در حذف کلید');
    } finally {
      setBusyProvider(null);
    }
  };

  const handleTestConnection = async (providerId: AiProviderId) => {
    setTestingProvider(providerId);
    setError(null);
    setNotice(null);
    try {
      const res = await testAdminProviderConnection(providerId);
      await loadOverview();
      if (res.result.ok) {
        setNotice(`${res.result.message} (تأخیر: ${formatNumber(res.result.latencyMs, locale, numeralStyle)} میلی‌ثانیه)`);
      } else {
        setError(res.result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در اجرای تست اتصال');
    } finally {
      setTestingProvider(null);
    }
  };

  const handleTestImageGeneration = async (providerId: AiProviderId) => {
    setTestingImageProvider(providerId);
    setError(null);
    setNotice(null);
    try {
      const res = await testAdminProviderImageGeneration(providerId);
      setImageTestResults((prev) => ({ ...prev, [providerId]: res.result }));
      await loadOverview();
      if (res.result.ok) {
        setNotice(
          `تست واقعی تولید تصویر (${res.result.modelId}) موفق بود — ${res.result.width}×${res.result.height} در ${formatNumber(res.result.latencyMs, locale, numeralStyle)} میلی‌ثانیه`
        );
      } else {
        setError(`تست تولید تصویر ناموفق (${res.result.errorCode || 'ERROR'}): ${res.result.message}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در اجرای تست واقعی تولید تصویر');
    } finally {
      setTestingImageProvider(null);
    }
  };

  const handleModelUpdate = async (model: AiModelSpecView, patch: Partial<AiModelSpecView>) => {
    setError(null);
    setNotice(null);
    try {
      await upsertAdminAiModel({
        ...model,
        ...patch,
      });
      await loadOverview();
      setNotice(`مدل «${model.displayName}» در رجیستری به‌روزرسانی شد.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در به‌روزرسانی مدل');
    }
  };

  const handleSetDefaultForCapability = async (model: AiModelSpecView, cap: AiCapability) => {
    const already = model.isDefaultForCapabilities.includes(cap);
    const nextDefaults = already
      ? model.isDefaultForCapabilities.filter((c) => c !== cap)
      : [...model.isDefaultForCapabilities, cap];
    await handleModelUpdate(model, { isDefaultForCapabilities: nextDefaults });
  };

  const handleCreateModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModel.modelId.trim()) return;
    setError(null);
    setNotice(null);
    try {
      await upsertAdminAiModel({
        providerId: newModel.providerId,
        modelId: newModel.modelId.trim(),
        displayName: newModel.displayName.trim() || newModel.modelId.trim(),
        capabilities: newModel.capabilities,
        maxInputSize: newModel.maxInputSize.trim() || '128K tokens',
        priority: Number(newModel.priority) || 15,
        availabilityStatus: 'available',
        fallbackEligible: true,
        isDefaultForCapabilities: [],
      });
      setNewModel({
        providerId: 'openai',
        modelId: '',
        displayName: '',
        capabilities: ['text_generation', 'structured_json'],
        maxInputSize: '128K tokens',
        priority: 15,
      });
      setShowAddModel(false);
      await loadOverview();
      setNotice('مدل جدید به رجیستری قابلیت‌ها اضافه شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در افزودن مدل جدید');
    }
  };

  const handlePolicyChange = async (patch: {
    credentialPolicy?: AiPlatformCredentialPolicy;
    allowBusinessFallbackToPlatform?: boolean;
    defaultCooldownMs?: number;
  }) => {
    setPolicyBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateAdminAiPolicy(patch);
      await loadOverview();
      setNotice('سیاست مسیریابی و اعتبارنامه‌های پلتفرم ذخیره شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره سیاست مسیریابی');
    } finally {
      setPolicyBusy(false);
    }
  };

  if (loading && !data) {
    return <LoadingState text="در حال بارگذاری مرکز مدیریت سرویس‌دهنده‌های هوش مصنوعی..." />;
  }

  if (error && !data) {
    return <ErrorState message={error} onRetry={() => void loadOverview()} />;
  }

  if (!data) return null;

  const activeProvidersCount = data.providers.filter((p) => p.enabled).length;
  const connectedProvidersCount = data.providers.filter((p) => p.connectionStatus === 'connected').length;
  const activeModelsCount = data.models.filter((m) => m.availabilityStatus !== 'disabled').length;

  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#F8FAFC] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#8B5CF6]" />
            <span>کنسول مدیریت سرویس‌دهنده‌ها و مدل‌های هوش مصنوعی (Super Admin)</span>
          </h2>
          <p className="text-xs text-[#94A3B8] mt-1">
            تنظیم کلیدهای رمزنگاری‌شده پلتفرم، رجیستری قابلیت‌های چندرسانه‌ای، سیاست Fallback و پایش مصرف واقعی
          </p>
        </div>
        <button
          onClick={() => void loadOverview()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#151E33] border border-[#273449] hover:border-[#6366F1] rounded-lg text-xs font-medium text-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>بروزرسانی وضعیت</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#151E33] border border-[#273449] rounded-xl p-4 space-y-1">
          <div className="text-xs text-[#94A3B8]">سرویس‌دهنده‌های فعال</div>
          <div className="text-lg font-bold text-[#F8FAFC] tabular-nums">
            {formatNumber(activeProvidersCount, locale, numeralStyle)} از {formatNumber(data.providers.length, locale, numeralStyle)}
          </div>
          <div className="text-[11px] text-[#94A3B8] tabular-nums">
            {formatNumber(connectedProvidersCount, locale, numeralStyle)} متصل تأییدشده
          </div>
        </div>

        <div className="bg-[#151E33] border border-[#273449] rounded-xl p-4 space-y-1">
          <div className="text-xs text-[#94A3B8]">مدل‌های ثبت‌شده در رجیستری</div>
          <div className="text-lg font-bold text-[#F8FAFC] tabular-nums">
            {formatNumber(activeModelsCount, locale, numeralStyle)}
          </div>
          <div className="text-[11px] text-[#94A3B8]">پشتیبانی از متن، تصویر، ویدیو و صدا</div>
        </div>

        <div className="bg-[#151E33] border border-[#273449] rounded-xl p-4 space-y-1">
          <div className="text-xs text-[#94A3B8]">کل درخواست‌های ثبت‌شده</div>
          <div className="text-lg font-bold text-[#F8FAFC] tabular-nums">
            {formatNumber(data.telemetry.totalRequests, locale, numeralStyle)}
          </div>
          <div className="text-[11px] text-[#94A3B8] tabular-nums">
            {formatNumber(data.telemetry.fallbackCount, locale, numeralStyle)} Fallback ·{' '}
            {formatNumber(data.telemetry.errorCount, locale, numeralStyle)} خطا
          </div>
        </div>

        <div className="bg-[#151E33] border border-[#273449] rounded-xl p-4 space-y-1">
          <div className="text-xs text-[#94A3B8]">میانگین تأخیر / هزینه تخمینی</div>
          <div className="text-lg font-bold text-[#F8FAFC] tabular-nums" dir="ltr">
            {formatDigits(data.telemetry.avgLatencyMs, numeralStyle)}ms · ${formatDigits(data.telemetry.totalEstimatedCostUsd.toFixed(4), numeralStyle)}
          </div>
          <div className="text-[11px] text-[#94A3B8] tabular-nums">
            توکن: {formatNumber(data.telemetry.totalInputTokens + data.telemetry.totalOutputTokens, locale, numeralStyle)}
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#273449] pb-3">
        {(
          [
            { id: 'providers', label: 'سرویس‌دهنده‌ها و کلیدهای API', icon: KeyRound },
            { id: 'models', label: 'رجیستری مدل‌ها و قابلیت‌ها', icon: Layers },
            { id: 'telemetry', label: 'سیاست مسیریابی، سلامت و لاگ‌ها', icon: Activity },
          ] as Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }>
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setError(null);
                setNotice(null);
              }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#6366F1] text-white'
                  : 'bg-[#151E33] border border-[#273449] text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {error && <ErrorState message={error} />}
      {notice && (
        <div className="p-3 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E] flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* TAB 1: PROVIDERS & ENCRYPTED CREDENTIALS */}
      {tab === 'providers' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {data.providers.map((provider) => {
            const connInfo = CONNECTION_LABELS[provider.connectionStatus] || CONNECTION_LABELS.untested;
            const edit = providerEdits[provider.id] || {
              priority: provider.priority,
              timeoutMs: provider.timeoutMs,
              maxRetries: provider.maxRetries,
              baseUrl: provider.baseUrl,
            };
            const isBusy = busyProvider === provider.id;
            const isTesting = testingProvider === provider.id;
            const circuitActive = Boolean(provider.circuitOpenUntil && provider.circuitOpenUntil > Date.now());

            return (
              <div key={provider.id} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#273449] pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-[#8B5CF6]" />
                      <h3 className="text-sm font-bold text-[#F8FAFC]">{provider.name}</h3>
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-1 flex flex-wrap items-center gap-2">
                      <span dir="ltr">{provider.id}</span>
                      <span>·</span>
                      <span className={connInfo.colorClass}>{connInfo.label}</span>
                      {provider.lastLatencyMs !== undefined && (
                        <>
                          <span>·</span>
                          <span className="tabular-nums" dir="ltr">
                            {formatDigits(provider.lastLatencyMs, numeralStyle)}ms
                          </span>
                        </>
                      )}
                      {circuitActive && (
                        <>
                          <span>·</span>
                          <span className="text-[#F59E0B]">مدارشکن فعال (Cooldown)</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleToggleProvider(provider, 'enabled')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                        provider.enabled
                          ? 'bg-[#22C55E]/15 border-[#22C55E]/40 text-[#22C55E]'
                          : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                      }`}
                    >
                      {provider.enabled ? 'فعال' : 'غیرفعال'}
                    </button>
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => void handleTestConnection(provider.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>{isTesting ? 'در حال تست...' : 'تست اتصال'}</span>
                    </button>
                    {data.models.some((m) => m.providerId === provider.id && m.capabilities.includes('image_generation')) && (
                      <button
                        type="button"
                        disabled={testingImageProvider === provider.id}
                        onClick={() => void handleTestImageGeneration(provider.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#11182A] border border-[#8B5CF6]/60 hover:border-[#8B5CF6] disabled:opacity-50 text-[#F8FAFC] text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-[#8B5CF6]" />
                        <span>{testingImageProvider === provider.id ? 'در حال تولید...' : 'تست تولید تصویر'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Credential Management */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#94A3B8]">
                      اعتبارنامه پلتفرم ({provider.credentialEnvVar})
                    </span>
                    <span className="font-mono text-[11px] text-[#F8FAFC]" dir="ltr">
                      {provider.hasCredential
                        ? `${provider.maskedCredential} (${provider.hasStoredPlatformKey ? 'AES-256' : 'Env'})`
                        : 'تنظیم نشده'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      dir="ltr"
                      value={keyDrafts[provider.id] || ''}
                      onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                      placeholder={`کلید جدید ${provider.name} را وارد کنید...`}
                      className="flex-1 min-w-[200px] bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-xs text-left outline-none"
                    />
                    <button
                      type="button"
                      disabled={isBusy || !(keyDrafts[provider.id] || '').trim()}
                      onClick={() => void handleSaveCredential(provider.id)}
                      className="px-3.5 py-2 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] disabled:opacity-40 rounded-lg text-xs font-medium text-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      ذخیره کلید رمزنگاری‌شده
                    </button>
                    {provider.hasStoredPlatformKey && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRemoveCredential(provider.id)}
                        title="حذف کلید ذخیره‌شده"
                        className="p-2 rounded-lg bg-[#0B1020] border border-[#273449] text-[#EF4444] hover:border-[#EF4444] shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Operational Parameters */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] text-[#94A3B8] mb-1">اولویت (Priority)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      dir="ltr"
                      value={edit.priority}
                      onChange={(e) =>
                        setProviderEdits((prev) => ({
                          ...prev,
                          [provider.id]: { ...edit, priority: Number(e.target.value) },
                        }))
                      }
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs tabular-nums outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#94A3B8] mb-1">Timeout (ms)</label>
                    <input
                      type="number"
                      min={2000}
                      max={180000}
                      step={500}
                      dir="ltr"
                      value={edit.timeoutMs}
                      onChange={(e) =>
                        setProviderEdits((prev) => ({
                          ...prev,
                          [provider.id]: { ...edit, timeoutMs: Number(e.target.value) },
                        }))
                      }
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs tabular-nums outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#94A3B8] mb-1">حداکثر Retry</label>
                    <input
                      type="number"
                      min={0}
                      max={4}
                      dir="ltr"
                      value={edit.maxRetries}
                      onChange={(e) =>
                        setProviderEdits((prev) => ({
                          ...prev,
                          [provider.id]: { ...edit, maxRetries: Number(e.target.value) },
                        }))
                      }
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs tabular-nums outline-none"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleToggleProvider(provider, 'fallbackEnabled')}
                      className={`w-full py-1.5 px-2.5 rounded-lg text-xs border whitespace-nowrap cursor-pointer ${
                        provider.fallbackEnabled
                          ? 'bg-[#6366F1]/15 border-[#6366F1]/50 text-[#F8FAFC]'
                          : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                      }`}
                    >
                      Fallback: {provider.fallbackEnabled ? 'روشن' : 'خاموش'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <input
                    dir="ltr"
                    value={edit.baseUrl}
                    onChange={(e) =>
                      setProviderEdits((prev) => ({
                        ...prev,
                        [provider.id]: { ...edit, baseUrl: e.target.value },
                      }))
                    }
                    className="flex-1 bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1.5 text-[11px] text-[#94A3B8] text-left outline-none"
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleSaveProviderParams(provider)}
                    className="px-3 py-1.5 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] rounded-lg text-xs text-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ذخیره تنظیمات
                  </button>
                </div>

                {provider.lastTestError && (
                  <div className="p-2.5 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[11px] text-[#EF4444] flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{provider.lastTestError}</span>
                  </div>
                )}

                {provider.detectedModels && provider.detectedModels.length > 0 && (
                  <div className="text-[11px] text-[#94A3B8] border-t border-[#273449] pt-2">
                    <span>مدل‌های شناسایی‌شده در آخرین تست: </span>
                    <span dir="ltr" className="font-mono text-[#F8FAFC]">
                      {provider.detectedModels.slice(0, 5).join(', ')}
                    </span>
                  </div>
                )}

                {(provider.lastImageTestAt || imageTestResults[provider.id]) && (
                  <div className="border-t border-[#273449] pt-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#94A3B8]">آخرین تست تولید تصویر:</span>
                      <span className={provider.lastImageTestOk ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                        {provider.lastImageTestOk ? 'تولید تصویر واقعی موفق' : 'ناموفق'}
                        {provider.lastImageTestModel ? ` · ${provider.lastImageTestModel}` : ''}
                      </span>
                    </div>
                    {provider.lastImageTestError && (
                      <div className="text-[11px] text-[#EF4444] bg-[#EF4444]/10 border border-[#EF4444]/25 rounded-lg p-2">
                        {provider.lastImageTestError}
                      </div>
                    )}
                    {imageTestResults[provider.id]?.previewDataUrl && (
                      <div className="flex items-center gap-3 bg-[#0B1020] border border-[#273449] rounded-lg p-2">
                        <img
                          src={imageTestResults[provider.id].previewDataUrl}
                          alt={`تست تصویر ${provider.name}`}
                          className="w-16 h-16 rounded object-cover border border-[#273449] shrink-0"
                        />
                        <div className="text-[11px] text-[#94A3B8] space-y-0.5 tabular-nums">
                          <div className="text-[#F8FAFC] font-medium" dir="ltr">
                            {imageTestResults[provider.id].width}×{imageTestResults[provider.id].height} · {imageTestResults[provider.id].mimeType}
                          </div>
                          <div dir="ltr">
                            {formatDigits(imageTestResults[provider.id].latencyMs, numeralStyle)}ms · ${formatDigits(imageTestResults[provider.id].estimatedCostUsd.toFixed(4), numeralStyle)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: MODEL CAPABILITY REGISTRY */}
      {tab === 'models' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#151E33] border border-[#273449] rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCapabilityFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap cursor-pointer ${
                  capabilityFilter === 'all'
                    ? 'bg-[#6366F1] text-white'
                    : 'bg-[#0B1020] text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                همه قابلیت‌ها ({formatNumber(data.models.length, locale, numeralStyle)})
              </button>
              {(Object.keys(CAPABILITY_LABELS) as AiCapability[]).map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => setCapabilityFilter(cap)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap cursor-pointer ${
                    capabilityFilter === cap
                      ? 'bg-[#6366F1] text-white'
                      : 'bg-[#0B1020] text-[#94A3B8] hover:text-[#F8FAFC]'
                  }`}
                >
                  {CAPABILITY_LABELS[cap]}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowAddModel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>افزودن مدل سفارشی</span>
            </button>
          </div>

          {showAddModel && (
            <form onSubmit={handleCreateModel} className="bg-[#151E33] border border-[#6366F1] rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[#F8FAFC]">ثبت مدل جدید در رجیستری</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">سرویس‌دهنده</label>
                  <select
                    value={newModel.providerId}
                    onChange={(e) => setNewModel((p) => ({ ...p, providerId: e.target.value as AiProviderId }))}
                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="fal">fal.ai</option>
                    <option value="replicate">Replicate</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">شناسه مدل (Model ID) *</label>
                  <input
                    dir="ltr"
                    required
                    value={newModel.modelId}
                    onChange={(e) => setNewModel((p) => ({ ...p, modelId: e.target.value }))}
                    placeholder="gpt-4.1"
                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs text-left outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">نام نمایشی</label>
                  <input
                    value={newModel.displayName}
                    onChange={(e) => setNewModel((p) => ({ ...p, displayName: e.target.value }))}
                    placeholder="GPT-4.1"
                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">اولویت</label>
                  <input
                    type="number"
                    dir="ltr"
                    value={newModel.priority}
                    onChange={(e) => setNewModel((p) => ({ ...p, priority: Number(e.target.value) }))}
                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs tabular-nums outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1.5">قابلیت‌ها (Capabilities)</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(CAPABILITY_LABELS) as AiCapability[]).map((cap) => {
                    const checked = newModel.capabilities.includes(cap);
                    return (
                      <button
                        key={cap}
                        type="button"
                        onClick={() =>
                          setNewModel((p) => ({
                            ...p,
                            capabilities: checked
                              ? p.capabilities.filter((c) => c !== cap)
                              : [...p.capabilities, cap],
                          }))
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs border cursor-pointer ${
                          checked
                            ? 'bg-[#6366F1]/20 border-[#6366F1] text-[#F8FAFC]'
                            : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                        }`}
                      >
                        {CAPABILITY_LABELS[cap]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModel(false)}
                  className="px-4 py-2 bg-[#0B1020] border border-[#273449] rounded-lg text-xs text-[#94A3B8]"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg"
                >
                  ثبت مدل در رجیستری
                </button>
              </div>
            </form>
          )}

          <div className="bg-[#151E33] border border-[#273449] rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="border-b border-[#273449] text-[#94A3B8]">
                <tr>
                  <th className="px-4 py-3 font-medium">مدل و سرویس‌دهنده</th>
                  <th className="px-4 py-3 font-medium">قابلیت‌ها و پیش‌فرض</th>
                  <th className="px-4 py-3 font-medium">محدودیت و فرمت</th>
                  <th className="px-4 py-3 font-medium">تعرفه مبنا</th>
                  <th className="px-4 py-3 font-medium">اولویت / Fallback</th>
                  <th className="px-4 py-3 font-medium">وضعیت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#273449]">
                {filteredModels.map((model) => (
                  <tr key={model.id} className="hover:bg-[#11182A]/60">
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-[#F8FAFC]">{model.displayName}</div>
                      <div className="text-[11px] text-[#94A3B8] font-mono mt-0.5" dir="ltr">
                        {model.providerId} / {model.modelId}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top space-y-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        {model.capabilities.map((cap) => {
                          const isDef = model.isDefaultForCapabilities.includes(cap);
                          return (
                            <button
                              key={cap}
                              type="button"
                              onClick={() => void handleSetDefaultForCapability(model, cap)}
                              title="کلیک برای تنظیم به‌عنوان پیش‌فرض این قابلیت"
                              className={`px-2 py-1 rounded text-[11px] border cursor-pointer ${
                                isDef
                                  ? 'bg-[#6366F1]/25 border-[#6366F1] text-[#F8FAFC] font-semibold'
                                  : 'bg-[#0B1020] border-[#273449] text-[#94A3B8] hover:text-[#F8FAFC]'
                              }`}
                            >
                              {CAPABILITY_LABELS[cap]}
                              {isDef ? ' ★' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-[11px] text-[#94A3B8]">
                      <div>ورودی: {model.maxInputSize}</div>
                      <div dir="ltr" className="text-right mt-0.5">
                        {model.outputFormats.join(', ')}
                        {model.maxOutputDurationSec ? ` · max ${model.maxOutputDurationSec}s` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-[11px] text-[#F8FAFC] tabular-nums" dir="ltr">
                      {model.pricingMetadata.unit === '1m_tokens'
                        ? `$${model.pricingMetadata.inputCostUsd ?? 0}/$${model.pricingMetadata.outputCostUsd ?? 0} per 1M`
                        : `$${model.pricingMetadata.unitCostUsd ?? 0} / ${model.pricingMetadata.unit}`}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-[#F8FAFC]">#{formatDigits(model.priority, numeralStyle)}</span>
                        <span className="text-[#94A3B8]">·</span>
                        <button
                          type="button"
                          onClick={() => void handleModelUpdate(model, { fallbackEligible: !model.fallbackEligible })}
                          className={`text-[11px] underline cursor-pointer ${
                            model.fallbackEligible ? 'text-[#22C55E]' : 'text-[#94A3B8]'
                          }`}
                        >
                          {model.fallbackEligible ? 'Fallback مجاز' : 'بدون Fallback'}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <select
                        value={model.availabilityStatus}
                        onChange={(e) =>
                          void handleModelUpdate(model, {
                            availabilityStatus: e.target.value as AiAvailabilityStatus,
                          })
                        }
                        className="bg-[#0B1020] border border-[#273449] rounded-lg px-2 py-1 text-[11px] outline-none"
                      >
                        <option value="available">در دسترس (Available)</option>
                        <option value="degraded">کند/ناپایدار (Degraded)</option>
                        <option value="disabled">غیرفعال (Disabled)</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: ROUTING POLICY, HEALTH & TELEMETRY */}
      {tab === 'telemetry' && (
        <div className="space-y-6">
          {/* Global Credential Policy */}
          <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">سیاست کلیدهای API و مسیریابی پلتفرم</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">سیاست استفاده از اعتبارنامه کسب‌وکارها</label>
                <select
                  disabled={policyBusy}
                  value={data.policy.credentialPolicy}
                  onChange={(e) =>
                    void handlePolicyChange({
                      credentialPolicy: e.target.value as AiPlatformCredentialPolicy,
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                >
                  <option value="customer_optional">اختیاری (پلتفرم یا کلید اختصاصی کسب‌وکار)</option>
                  <option value="platform_only">فقط کلیدهای مرکزی پلتفرم</option>
                  <option value="customer_required">الزامی (هر کسب‌وکار باید کلید خود را ثبت کند)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">زمان Cooldown مدارشکن (میلی‌ثانیه)</label>
                <select
                  disabled={policyBusy}
                  value={data.policy.defaultCooldownMs}
                  onChange={(e) => void handlePolicyChange({ defaultCooldownMs: Number(e.target.value) })}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                >
                  <option value={30000}>۳۰ ثانیه</option>
                  <option value={60000}>۶۰ ثانیه</option>
                  <option value={90000}>۹۰ ثانیه (استاندارد)</option>
                  <option value={180000}>۳ دقیقه</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={policyBusy}
                  onClick={() =>
                    void handlePolicyChange({
                      allowBusinessFallbackToPlatform: !data.policy.allowBusinessFallbackToPlatform,
                    })
                  }
                  className={`w-full py-2 px-3 rounded-lg text-xs border cursor-pointer ${
                    data.policy.allowBusinessFallbackToPlatform
                      ? 'bg-[#22C55E]/15 border-[#22C55E]/40 text-[#22C55E]'
                      : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                  }`}
                >
                  Fallback کلید مشتری به پلتفرم: {data.policy.allowBusinessFallbackToPlatform ? 'مجاز' : 'مسدود'}
                </button>
              </div>
            </div>
          </div>

          {/* Per-Provider Telemetry Breakdown */}
          <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">آمار عملکرد به تفکیک سرویس‌دهنده</h3>
            {Object.keys(data.telemetry.byProvider).length === 0 ? (
              <div className="text-xs text-[#94A3B8] py-4">هنوز هیچ درخواست هوش مصنوعی در لاگ‌ها ثبت نشده است.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="border-b border-[#273449] text-[#94A3B8]">
                    <tr>
                      <th className="px-3 py-2">سرویس‌دهنده</th>
                      <th className="px-3 py-2">تعداد درخواست</th>
                      <th className="px-3 py-2">Fallback</th>
                      <th className="px-3 py-2">خطاها</th>
                      <th className="px-3 py-2">میانگین تأخیر</th>
                      <th className="px-3 py-2">هزینه تخمینی</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#273449]">
                    {Object.entries(data.telemetry.byProvider).map(([pid, stats]) => (
                      <tr key={pid}>
                        <td className="px-3 py-2.5 font-medium text-[#F8FAFC]" dir="ltr">
                          {pid}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{formatNumber(stats.requests, locale, numeralStyle)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-[#F59E0B]">
                          {formatNumber(stats.fallbacks, locale, numeralStyle)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-[#EF4444]">
                          {formatNumber(stats.errors, locale, numeralStyle)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums" dir="ltr">
                          {formatDigits(stats.avgLatencyMs, numeralStyle)} ms
                        </td>
                        <td className="px-3 py-2.5 tabular-nums" dir="ltr">
                          ${formatDigits(stats.estimatedCostUsd.toFixed(6), numeralStyle)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent AI Request Logs */}
          <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#F8FAFC]">تاریخچه درخواست‌ها و خطاهای API</h3>
              <span className="text-xs text-[#94A3B8] tabular-nums">
                {formatNumber(data.recentLogs.length, locale, numeralStyle)} لاگ اخیر
              </span>
            </div>
            {data.recentLogs.length === 0 ? (
              <div className="text-xs text-[#94A3B8] py-6 text-center">
                هنوز درخواستی از طریق روتر چندسرویس‌دهنده‌ای اجرا نشده است.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="border-b border-[#273449] text-[#94A3B8]">
                    <tr>
                      <th className="px-3 py-2">زمان</th>
                      <th className="px-3 py-2">قابلیت / مدل</th>
                      <th className="px-3 py-2">منبع کلید</th>
                      <th className="px-3 py-2">تأخیر</th>
                      <th className="px-3 py-2">توکن / هزینه</th>
                      <th className="px-3 py-2">وضعیت / جزئیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#273449]">
                    {data.recentLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#11182A]/50">
                        <td className="px-3 py-2.5 text-[11px] text-[#94A3B8] whitespace-nowrap tabular-nums">
                          {formatJalaliDateTime(log.createdAt, locale, numeralStyle)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="text-[#F8FAFC] font-medium">
                            {CAPABILITY_LABELS[log.capability] || log.capability}
                            {log.isTest ? ' (تست ادمین)' : ''}
                          </div>
                          <div className="text-[11px] text-[#94A3B8] font-mono" dir="ltr">
                            {log.providerId} / {log.modelId}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]">
                          {log.credentialSource === 'customer' ? 'کلید مشتری' : 'پلتفرم'}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-[11px]" dir="ltr">
                          {formatDigits(log.latencyMs, numeralStyle)}ms
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-[11px]" dir="ltr">
                          {formatDigits(log.inputTokens + log.outputTokens, numeralStyle)} tok · $
                          {formatDigits(log.estimatedCostUsd.toFixed(5), numeralStyle)}
                        </td>
                        <td className="px-3 py-2.5 text-[11px]">
                          {log.status === 'success' && <span className="text-[#22C55E]">موفق</span>}
                          {log.status === 'fallback_success' && (
                            <span className="text-[#F59E0B]">
                              موفق با Fallback ({log.attemptedModels.length} تلاش)
                            </span>
                          )}
                          {log.status === 'error' && (
                            <span className="text-[#EF4444]">
                              خطا ({log.errorCode || 'ERR'}): {log.errorMessage?.slice(0, 90)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
