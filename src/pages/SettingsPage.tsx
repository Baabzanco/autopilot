import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Check, Cpu, FileClock, Globe, KeyRound, Plus, Sparkles, Trash2, User, Zap } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  fetchBusinessAiSettings,
  testBusinessProviderKey,
  updateBusinessAiSettings,
  type BusinessAiSettingsResponse,
} from '../services/apiClient';
import { logActivity, updateBusiness, updateUserProfile } from '../services/dataAccess';
import { formatDigits, formatJalaliDateTime, formatNumber } from '../lib/localization';
import type {
  ActivityLog,
  Agent,
  AiProviderId,
  Business,
  CurrencyCode,
  LocaleCode,
  NumeralStyle,
  UserProfile,
} from '../types/domain';
import { ErrorState } from '../components/ui/Primitives';

type SettingsTab = 'profile' | 'business' | 'ai_credentials' | 'audit' | 'plan';

export function SettingsPage({
  userProfile,
  business,
  businesses,
  agents,
  activityLogs,
  onSelectBusiness,
  onCreateNewBusiness,
  onReopenWizard,
}: {
  userProfile: UserProfile;
  business: Business;
  businesses: Business[];
  agents: Agent[];
  activityLogs: ActivityLog[];
  onSelectBusiness: (bizId: string) => Promise<void>;
  onCreateNewBusiness: (name: string, creatorName: string) => Promise<void>;
  onReopenWizard: () => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [tab, setTab] = useState<SettingsTab>('profile');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // User localization form
  const [displayName, setDisplayName] = useState(userProfile.displayName);
  const [preferredLocale, setPreferredLocale] = useState<LocaleCode>(userProfile.preferredLocale || 'fa');
  const [preferredNumerals, setPreferredNumerals] = useState<NumeralStyle>(
    userProfile.preferredNumerals || business.numeralStyle || 'persian'
  );
  const [preferredCurrency, setPreferredCurrency] = useState<CurrencyCode>(
    userProfile.preferredCurrency || business.currency || 'IRT'
  );

  // Business settings form
  const [bizName, setBizName] = useState(business.name);
  const [creatorName, setCreatorName] = useState(business.creatorName || '');
  const [category, setCategory] = useState(business.category || '');
  const [niche, setNiche] = useState(business.niche || '');
  const [description, setDescription] = useState(business.description || '');
  const [website, setWebsite] = useState(business.website || '');
  const [location, setLocation] = useState(business.location || '');
  const [bizCurrency, setBizCurrency] = useState<CurrencyCode>(business.currency || 'IRT');
  const [bizNumerals, setBizNumerals] = useState<NumeralStyle>(business.numeralStyle || 'persian');
  const [brandVoice, setBrandVoice] = useState(business.brandSettings?.voice || '');
  const [avoidWords, setAvoidWords] = useState(business.brandSettings?.avoidWords || '');

  // New workspace modal
  const [showNewBiz, setShowNewBiz] = useState(false);
  const [newBizName, setNewBizName] = useState('');

  const totalTokens = agents.reduce((acc, a) => acc + (a.totalTokensUsed || 0), 0);
  const totalCost = agents.reduce((acc, a) => acc + (a.estimatedCostUsd || 0), 0);

  // Business AI Credentials & Usage state
  const [aiSettingsData, setAiSettingsData] = useState<BusinessAiSettingsResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [customerKeyDrafts, setCustomerKeyDrafts] = useState<Record<string, string>>({});
  const [testingPid, setTestingPid] = useState<string | null>(null);

  const loadBusinessAi = useCallback(async () => {
    setAiLoading(true);
    try {
      const res = await fetchBusinessAiSettings(business);
      setAiSettingsData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت تنظیمات هوش مصنوعی کسب‌وکار');
    } finally {
      setAiLoading(false);
    }
  }, [business]);

  useEffect(() => {
    if (tab === 'ai_credentials') {
      void loadBusinessAi();
    }
  }, [tab, loadBusinessAi]);

  const handleCredentialModeChange = async (mode: 'platform' | 'customer') => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await updateBusinessAiSettings({ business, credentialMode: mode });
      await loadBusinessAi();
      setSavedMsg('حالت اعتبارنامه هوش مصنوعی کسب‌وکار به‌روزرسانی شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تغییر حالت کلید API');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCustomerKey = async (providerId: AiProviderId) => {
    const raw = (customerKeyDrafts[providerId] || '').trim();
    if (raw.length < 8) {
      setError('کلید API باید حداقل ۸ کاراکتر معتبر داشته باشد.');
      return;
    }
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await updateBusinessAiSettings({
        business,
        setCustomerKey: { providerId, apiKey: raw },
      });
      setCustomerKeyDrafts((prev) => ({ ...prev, [providerId]: '' }));
      await loadBusinessAi();
      setSavedMsg(`کلید اختصاصی ${providerId} با رمزنگاری AES-256 ذخیره شد.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره کلید اختصاصی');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCustomerKey = async (providerId: AiProviderId) => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await updateBusinessAiSettings({
        business,
        removeCustomerKeyProvider: providerId,
      });
      await loadBusinessAi();
      setSavedMsg(`کلید اختصاصی ${providerId} حذف شد.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در حذف کلید اختصاصی');
    } finally {
      setSaving(false);
    }
  };

  const handleTestCustomerKey = async (providerId: AiProviderId) => {
    setTestingPid(providerId);
    setError(null);
    setSavedMsg(null);
    try {
      const draft = (customerKeyDrafts[providerId] || '').trim();
      const res = await testBusinessProviderKey({
        business,
        providerId,
        ...(draft ? { apiKey: draft } : {}),
      });
      if (res.result.ok) {
        setSavedMsg(`${res.result.message} (${formatDigits(res.result.latencyMs, numeralStyle)}ms)`);
      } else {
        setError(res.result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تست کلید اختصاصی');
    } finally {
      setTestingPid(null);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await updateUserProfile(userProfile.id, {
        displayName: displayName.trim() || userProfile.displayName,
        preferredLocale,
        preferredNumerals,
        preferredCurrency,
      });
      await updateBusiness(business.id, {
        numeralStyle: preferredNumerals,
        currency: preferredCurrency,
      });
      setLocale(preferredLocale);
      setSavedMsg('تنظیمات کاربری و بومی‌سازی ذخیره شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات کاربری');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await updateBusiness(business.id, {
        name: bizName.trim() || business.name,
        creatorName: creatorName.trim(),
        category: category.trim(),
        niche: niche.trim(),
        description: description.trim(),
        website: website.trim(),
        location: location.trim(),
        currency: bizCurrency,
        numeralStyle: bizNumerals,
        brandSettings: {
          ...(business.brandSettings || {
            voice: '',
            communicationStyle: 'محاوره‌ای استاندارد',
            personality: '',
            preferredTerms: '',
            avoidWords: '',
            primaryColor: '#6366F1',
            secondaryColor: '#8B5CF6',
          }),
          voice: brandVoice.trim(),
          avoidWords: avoidWords.trim(),
        },
      });
      await logActivity(business.id, userProfile.id, {
        actorType: 'owner',
        actorName: creatorName.trim() || userProfile.displayName,
        action: 'به‌روزرسانی تنظیمات کسب‌وکار',
        entityType: 'business',
        entityId: business.id,
        details: `پروفایل و تنظیمات بومی‌سازی کسب‌وکار «${bizName.trim() || business.name}» ویرایش شد.`,
      });
      setSavedMsg('پروفایل کسب‌وکار با موفقیت به‌روزرسانی شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات کسب‌وکار');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBizName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onCreateNewBusiness(newBizName.trim(), userProfile.displayName);
      setNewBizName('');
      setShowNewBiz(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ایجاد فضای کسب‌وکار جدید');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#273449] pb-3">
        {(
          [
            { id: 'profile', label: 'پروفایل و بومی‌سازی', icon: User },
            { id: 'business', label: 'تنظیمات کسب‌وکار و برند', icon: Building2 },
            { id: 'ai_credentials', label: 'کلید و مصرف AI کسب‌وکار', icon: KeyRound },
            { id: 'audit', label: 'تاریخچه ممیزی (Audit Log)', icon: FileClock },
            { id: 'plan', label: 'اشتراک و مصرف هوش مصنوعی', icon: Cpu },
          ] as Array<{ id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }>
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setSavedMsg(null);
                setError(null);
              }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
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
      {savedMsg && (
        <div className="p-3 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E] flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

      {tab === 'profile' && (
        <form onSubmit={handleSaveUser} className="bg-[#151E33] border border-[#273449] rounded-xl p-6 space-y-5 max-w-3xl">
          <div className="flex items-center gap-2 border-b border-[#273449] pb-3">
            <Globe className="w-4 h-4 text-[#8B5CF6]" />
            <h2 className="text-sm font-semibold text-[#F8FAFC]">تنظیمات زبان، ارقام و واحد پول</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#94A3B8] mb-1.5">نام نمایشی</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-[#94A3B8] mb-1.5">ایمیل حساب کاربری</label>
              <input
                dir="ltr"
                disabled
                value={userProfile.email}
                className="w-full bg-[#0B1020]/60 border border-[#273449] rounded-lg px-3 py-2 text-xs text-[#94A3B8] text-left"
              />
            </div>
            <div>
              <label className="block text-xs text-[#94A3B8] mb-1.5">زبان رابط کاربری</label>
              <select
                value={preferredLocale}
                onChange={(e) => setPreferredLocale(e.target.value as LocaleCode)}
                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              >
                <option value="fa">فارسی (راست‌به‌چپ — پیش‌فرض)</option>
                <option value="en">English (LTR)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#94A3B8] mb-1.5">نمایش ارقام</label>
              <select
                value={preferredNumerals}
                onChange={(e) => setPreferredNumerals(e.target.value as NumeralStyle)}
                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              >
                <option value="persian">ارقام فارسی (۱۲۳۴۵)</option>
                <option value="latin">ارقام لاتین (12345)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#94A3B8] mb-1.5">واحد پول پیش‌فرض</label>
              <select
                value={preferredCurrency}
                onChange={(e) => setPreferredCurrency(e.target.value as CurrencyCode)}
                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              >
                <option value="IRT">تومان (IRT)</option>
                <option value="IRR">ریال (IRR)</option>
                <option value="USD">دلار (USD)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg"
            >
              {saving ? 'در حال ذخیره...' : t.common.save}
            </button>
          </div>
        </form>
      )}

      {tab === 'business' && (
        <div className="space-y-6">
          {/* Workspace Switcher */}
          <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-[#94A3B8]">فضای کاری فعال:</span>
              <select
                value={business.id}
                onChange={(e) => onSelectBusiness(e.target.value)}
                className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-1.5 text-xs outline-none"
              >
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onReopenWizard}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] text-xs font-medium rounded-lg"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#8B5CF6]" />
                <span>ویرایش در راهنمای ۷ مرحله‌ای</span>
              </button>
              <button
                type="button"
                onClick={() => setShowNewBiz((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>کسب‌وکار جدید</span>
              </button>
            </div>
          </div>

          {showNewBiz && (
            <form onSubmit={handleCreateWorkspace} className="bg-[#151E33] border border-[#6366F1] rounded-xl p-5 flex flex-wrap items-center gap-3">
              <input
                value={newBizName}
                onChange={(e) => setNewBizName(e.target.value)}
                placeholder="نام کسب‌وکار جدید..."
                className="flex-1 min-w-[200px] bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              />
              <button type="submit" disabled={saving} className="px-4 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg">
                ایجاد فضای کاری
              </button>
            </form>
          )}

          <form onSubmit={handleSaveBusiness} className="bg-[#151E33] border border-[#273449] rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-[#F8FAFC] border-b border-[#273449] pb-3">
              اطلاعات هویتی و برند کسب‌وکار
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">نام برند / کسب‌وکار</label>
                <input
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">نام سازنده محتوا</label>
                <input
                  value={creatorName}
                  onChange={(e) => setCreatorName(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">دسته‌بندی</label>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">حوزه تخصصی (Niche)</label>
                <input
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">وب‌سایت</label>
                <input
                  dir="ltr"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none text-left"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">موقعیت مکانی</label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">واحد پول کسب‌وکار</label>
                <select
                  value={bizCurrency}
                  onChange={(e) => setBizCurrency(e.target.value as CurrencyCode)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                >
                  <option value="IRT">تومان (IRT)</option>
                  <option value="IRR">ریال (IRR)</option>
                  <option value="USD">دلار (USD)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">ارقام نمایش داده‌شده</label>
                <select
                  value={bizNumerals}
                  onChange={(e) => setBizNumerals(e.target.value as NumeralStyle)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                >
                  <option value="persian">ارقام فارسی</option>
                  <option value="latin">ارقام لاتین</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">لحن برند</label>
                <input
                  value={brandVoice}
                  onChange={(e) => setBrandVoice(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1.5">واژگان ممنوعه</label>
                <input
                  value={avoidWords}
                  onChange={(e) => setAvoidWords(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-[#94A3B8] mb-1.5">توضیحات کسب‌وکار</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none leading-relaxed"
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg"
              >
                {saving ? 'در حال ذخیره...' : t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === 'ai_credentials' && (
        <div className="space-y-6">
          <div className="bg-[#151E33] border border-[#273449] rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#273449] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#F8FAFC]">منبع اعتبارنامه هوش مصنوعی (Credential Mode)</h2>
                <p className="text-xs text-[#94A3B8] mt-1">
                  انتخاب کنید درخواست‌های این کسب‌وکار از سهمیه مرکزی پلتفرم استفاده کنند یا کلیدهای API اختصاصی خودتان (رمزنگاری‌شده).
                </p>
              </div>
              {aiSettingsData && (
                <div className="text-xs text-[#94A3B8]">
                  سیاست پلتفرم:{' '}
                  <span className="text-[#F8FAFC] font-medium">
                    {aiSettingsData.settings.platformPolicy === 'platform_only'
                      ? 'فقط کلید پلتفرم'
                      : aiSettingsData.settings.platformPolicy === 'customer_required'
                      ? 'الزامی بودن کلید مشتری'
                      : 'انتخاب آزاد کسب‌وکار'}
                  </span>
                </div>
              )}
            </div>

            {aiLoading && !aiSettingsData ? (
              <div className="text-xs text-[#94A3B8] py-4">در حال بارگذاری تنظیمات AI...</div>
            ) : aiSettingsData ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={saving || aiSettingsData.settings.platformPolicy === 'customer_required'}
                    onClick={() => void handleCredentialModeChange('platform')}
                    className={`p-4 rounded-xl border text-right transition-colors cursor-pointer ${
                      aiSettingsData.settings.credentialMode === 'platform'
                        ? 'bg-[#6366F1]/15 border-[#6366F1] text-[#F8FAFC]'
                        : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                    }`}
                  >
                    <div className="text-xs font-bold">استفاده از سهمیه مرکزی پلتفرم (Platform)</div>
                    <div className="text-[11px] opacity-80 mt-1">
                      تمام مدل‌های فعال پلتفرم بدون نیاز به وارد کردن کلید شخصی در دسترس هستند.
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={saving || aiSettingsData.settings.platformPolicy === 'platform_only'}
                    onClick={() => void handleCredentialModeChange('customer')}
                    className={`p-4 rounded-xl border text-right transition-colors cursor-pointer ${
                      aiSettingsData.settings.credentialMode === 'customer'
                        ? 'bg-[#6366F1]/15 border-[#6366F1] text-[#F8FAFC]'
                        : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                    }`}
                  >
                    <div className="text-xs font-bold">استفاده از کلید API اختصاصی کسب‌وکار (BYOK)</div>
                    <div className="text-[11px] opacity-80 mt-1">
                      کلیدها فقط برای این کسب‌وکار به‌صورت AES-256-GCM رمزنگاری و ایزوله می‌شوند.
                    </div>
                  </button>
                </div>

                {aiSettingsData.settings.credentialMode === 'customer' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    {(['gemini', 'openai', 'fal', 'replicate'] as AiProviderId[]).map((pid) => {
                      const info = aiSettingsData.settings.customerKeys[pid];
                      return (
                        <div key={pid} className="bg-[#0B1020] border border-[#273449] rounded-xl p-4 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#F8FAFC]" dir="ltr">
                              {pid.toUpperCase()}
                            </span>
                            <span className="text-[11px] font-mono text-[#94A3B8]" dir="ltr">
                              {info?.configured ? info.maskedPreview : 'ثبت نشده'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              dir="ltr"
                              value={customerKeyDrafts[pid] || ''}
                              onChange={(e) =>
                                setCustomerKeyDrafts((prev) => ({ ...prev, [pid]: e.target.value }))
                              }
                              placeholder="کلید API اختصاصی..."
                              className="flex-1 bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs text-left outline-none"
                            />
                            <button
                              type="button"
                              disabled={saving || !(customerKeyDrafts[pid] || '').trim()}
                              onClick={() => void handleSaveCustomerKey(pid)}
                              className="px-3 py-1.5 bg-[#6366F1] disabled:opacity-40 text-white text-xs rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              ذخیره
                            </button>
                            <button
                              type="button"
                              disabled={testingPid === pid || (!info?.configured && !(customerKeyDrafts[pid] || '').trim())}
                              onClick={() => void handleTestCustomerKey(pid)}
                              className="p-1.5 bg-[#151E33] border border-[#273449] hover:border-[#6366F1] rounded-lg text-[#F8FAFC] shrink-0 cursor-pointer"
                              title="تست کلید"
                            >
                              <Zap className="w-3.5 h-3.5" />
                            </button>
                            {info?.configured && (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void handleRemoveCustomerKey(pid)}
                                className="p-1.5 bg-[#151E33] border border-[#273449] text-[#EF4444] rounded-lg shrink-0 cursor-pointer"
                                title="حذف کلید"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-[#273449]">
                  <div>
                    <div className="text-[11px] text-[#94A3B8]">درخواست‌های ثبت‌شده این کسب‌وکار</div>
                    <div className="text-base font-bold text-[#F8FAFC] tabular-nums mt-0.5">
                      {formatNumber(aiSettingsData.telemetry.totalRequests, locale, numeralStyle)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#94A3B8]">میانگین زمان پاسخ</div>
                    <div className="text-base font-bold text-[#F8FAFC] tabular-nums mt-0.5" dir="ltr">
                      {formatDigits(aiSettingsData.telemetry.avgLatencyMs, numeralStyle)} ms
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#94A3B8]">هزینه تخمینی روتر AI</div>
                    <div className="text-base font-bold text-[#F8FAFC] tabular-nums mt-0.5" dir="ltr">
                      ${formatDigits(aiSettingsData.telemetry.totalEstimatedCostUsd.toFixed(5), numeralStyle)}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#273449] pb-3">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">تاریخچه کامل رویدادها و ممیزی (تغییرناپذیر)</h2>
            <span className="text-xs text-[#94A3B8] tabular-nums">
              {formatNumber(activityLogs.length, locale, numeralStyle)} رکورد
            </span>
          </div>
          {activityLogs.length === 0 ? (
            <div className="text-xs text-[#94A3B8] py-8 text-center">هنوز رویدادی ثبت نشده است.</div>
          ) : (
            <div className="divide-y divide-[#273449]">
              {activityLogs.map((log) => (
                <div key={log.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="space-y-0.5">
                    <div className="font-medium text-[#F8FAFC]">
                      {log.action} · <span className="text-[#8B5CF6]">{log.actorName || log.actorType}</span>
                    </div>
                    <div className="text-[#94A3B8]">{log.details}</div>
                  </div>
                  <div className="text-[11px] text-[#94A3B8] tabular-nums shrink-0">
                    {formatJalaliDateTime(log.createdAt, locale, numeralStyle)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'plan' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#151E33] border border-[#273449] rounded-xl p-6 space-y-3">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">نسخه و طرح فعال فضای کاری</h2>
            <div className="text-lg font-bold text-[#8B5CF6]">Creator Edition (MVP)</div>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              شامل ۵ ایجنت تخصصی هوش مصنوعی، تقویم شمسی و استودیو محتوا، مدیریت CRM، کاتالوگ محصولات دیجیتال و مرکز تأیید انسانی.
            </p>
          </div>
          <div className="bg-[#151E33] border border-[#273449] rounded-xl p-6 space-y-3">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">شفافیت مصرف توکن هوش مصنوعی</h2>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-[#94A3B8]">مجموع توکن‌های ثبت‌شده:</span>
              <span className="text-base font-bold text-[#F8FAFC] tabular-nums">
                {formatNumber(totalTokens, locale, numeralStyle)}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-[#94A3B8]">هزینه تخمینی کل ({t.common.estimated}):</span>
              <span className="text-base font-bold text-[#F8FAFC] tabular-nums" dir="ltr">
                ${formatDigits(totalCost.toFixed(4), numeralStyle)}
              </span>
            </div>
            <div className="text-[11px] text-[#94A3B8] pt-2 border-t border-[#273449]">
              اعداد فوق مستقیماً از پاسخ‌های سرور Gemini محاسبه و در پروفایل ایجنت‌ها ذخیره شده‌اند.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
