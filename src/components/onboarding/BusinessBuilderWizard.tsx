import React, { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { generateOnboardingSummary } from '../../services/apiClient';
import { createMemoryItem, logActivity, updateBusiness } from '../../services/dataAccess';
import type { Business, CurrencyCode } from '../../types/domain';
import { formatDigits } from '../../lib/localization';

const MONETIZATION_OPTIONS = [
  { id: 'digital_products', label: 'محصولات دیجیتال (فایل، قالب، جزوه)' },
  { id: 'online_courses', label: 'دوره‌های آموزشی آنلاین' },
  { id: 'consulting', label: 'مشاوره و خدمات تخصصی' },
  { id: 'sponsored_content', label: 'اسپانسرشیپ و تبلیغات برندها' },
  { id: 'affiliate', label: 'بازاریابی پورسانتی (افیلیت)' },
  { id: 'paid_communities', label: 'انجمن یا کانال اشتراکی پولی' },
  { id: 'newsletter', label: 'خبرنامه ویژه' },
  { id: 'brand_partnerships', label: 'همکاری بلندمدت با برندها' },
];

const PLATFORM_OPTIONS = [
  { id: 'instagram', label: 'اینستاگرام' },
  { id: 'telegram', label: 'تلگرام' },
  { id: 'youtube', label: 'یوتیوب' },
  { id: 'linkedin', label: 'لینکدین' },
  { id: 'tiktok', label: 'تیک‌تاک' },
  { id: 'x', label: 'ایکس' },
];

export function BusinessBuilderWizard({
  business,
  ownerId,
  onCompleted,
}: {
  business: Business;
  ownerId: string;
  onCompleted: (updated: Business) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<number>(business.onboardingStep && business.onboardingStep >= 1 && business.onboardingStep <= 7 ? business.onboardingStep : 1);
  const [form, setForm] = useState<Business>(business);
  const [saving, setSaving] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiInsights, setAiInsights] = useState<{ opportunities: string[]; plan: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stepLabels = [
    t.onboarding.steps.identity,
    t.onboarding.steps.creator,
    t.onboarding.steps.audience,
    t.onboarding.steps.brand,
    t.onboarding.steps.goals,
    t.onboarding.steps.monetization,
    t.onboarding.steps.review,
  ];

  const persistProgress = async (nextStep: number, extraPatch: Partial<Business> = {}) => {
    if (!form.name.trim()) {
      setError('لطفاً نام کسب‌وکار یا رسانه خود را وارد کنید.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const merged: Business = { ...form, ...extraPatch, onboardingStep: nextStep };
      await updateBusiness(business.id, {
        name: merged.name,
        creatorName: merged.creatorName,
        category: merged.category,
        niche: merged.niche,
        description: merged.description,
        website: merged.website,
        location: merged.location,
        primaryLanguage: merged.primaryLanguage,
        currency: merged.currency,
        numeralStyle: merged.numeralStyle,
        creatorProfile: merged.creatorProfile,
        audienceProfile: merged.audienceProfile,
        brandSettings: merged.brandSettings,
        businessGoals: merged.businessGoals,
        monetizationModels: merged.monetizationModels,
        profileSummary: merged.profileSummary,
        onboardingStep: nextStep,
      });
      setForm(merged);
      setStep(nextStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره‌سازی پیشرفت');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateAiSummary = async () => {
    setGeneratingAi(true);
    setError(null);
    try {
      const res = await generateOnboardingSummary(form);
      setForm((prev) => ({ ...prev, profileSummary: res.summary }));
      setAiInsights({
        opportunities: res.keyOpportunities,
        plan: res.recommendedFirstWeekPlan,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تولید خلاصه هوش مصنوعی');
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleCompleteOnboarding = async () => {
    setSaving(true);
    setError(null);
    try {
      const finalSummary =
        form.profileSummary?.trim() ||
        `${form.name} — فعالیت در حوزه ${form.niche || form.category} با تمرکز بر ${form.audienceProfile?.description || 'مخاطبان فارسی‌زبان'}.`;

      const patch: Partial<Business> = {
        ...form,
        profileSummary: finalSummary,
        profileConfirmed: true,
        onboardingStatus: 'completed',
        onboardingStep: 7,
      };
      await updateBusiness(business.id, patch);

      await createMemoryItem(business.id, ownerId, {
        category: 'business_profile',
        title: 'پروفایل تأییدشده کسب‌وکار',
        content: finalSummary,
        sourceType: 'owner_confirmed',
        verifiedByOwner: true,
        confidence: 1,
      });

      if (form.brandSettings?.voice) {
        await createMemoryItem(business.id, ownerId, {
          category: 'brand_identity',
          title: 'لحن و هویت برند',
          content: `لحن: ${form.brandSettings.voice} | سبک: ${form.brandSettings.communicationStyle} | واژگان ممنوعه: ${form.brandSettings.avoidWords || 'ندارد'}`,
          sourceType: 'owner_confirmed',
          verifiedByOwner: true,
          confidence: 1,
        });
      }

      if (form.audienceProfile?.description) {
        await createMemoryItem(business.id, ownerId, {
          category: 'audience_profile',
          title: 'تعریف مخاطبان هدف',
          content: `${form.audienceProfile.description} | دغدغه‌ها: ${form.audienceProfile.painPoints}`,
          sourceType: 'owner_confirmed',
          verifiedByOwner: true,
          confidence: 1,
        });
      }

      await logActivity(business.id, ownerId, {
        actorType: 'owner',
        actorName: form.creatorName || 'مالک کسب‌وکار',
        action: 'تکمیل راه‌اندازی کسب‌وکار',
        entityType: 'business',
        entityId: business.id,
        details: 'پروفایل کسب‌وکار تأیید و در حافظه مشترک ایجنت‌ها ثبت شد.',
      });

      onCompleted({ ...form, ...patch } as Business);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تکمیل راه‌اندازی');
    } finally {
      setSaving(false);
    }
  };

  const toggleArrayItem = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] py-8 px-4 md:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#273449] pb-5">
          <div>
            <h1 className="text-xl font-bold text-[#F8FAFC]">{t.onboarding.title}</h1>
            <p className="text-sm text-[#94A3B8] mt-1">{t.onboarding.subtitle}</p>
          </div>
          <div className="text-xs font-medium text-[#94A3B8] tabular-nums whitespace-nowrap">
            {formatDigits(`مرحله ${step} از ۷`, form.numeralStyle || 'persian')}
          </div>
        </div>

        {/* Stepper Navigation */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          {stepLabels.map((label, idx) => {
            const num = idx + 1;
            const active = num === step;
            const done = num < step;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setStep(num)}
                className={`text-right px-3 py-2 rounded-lg border text-xs transition-colors ${
                  active
                    ? 'bg-[#6366F1]/15 border-[#6366F1] text-[#F8FAFC] font-semibold'
                    : done
                    ? 'bg-[#151E33] border-[#273449] text-[#22C55E]'
                    : 'bg-[#11182A] border-[#273449] text-[#94A3B8]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="tabular-nums">{formatDigits(num, form.numeralStyle || 'persian')}.</span>
                  <span className="truncate">{label}</span>
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#EF4444]">
            {error}
          </div>
        )}

        {/* Step Card */}
        <div className="bg-[#151E33] border border-[#273449] rounded-xl p-6 space-y-5">
          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">نام کسب‌وکار یا برند</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="مثلاً: آکادمی طراحی سارا"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">نام سازنده محتوا</label>
                <input
                  value={form.creatorName || ''}
                  onChange={(e) => setForm({ ...form, creatorName: e.target.value })}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="نام و نام خانوادگی"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">دسته‌بندی کسب‌وکار</label>
                <input
                  value={form.category || ''}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="مثلاً: آموزش آنلاین، فناوری، سبک زندگی"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">واحد پول اصلی</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value as CurrencyCode })}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                >
                  <option value="IRT">تومان (IRT)</option>
                  <option value="IRR">ریال (IRR)</option>
                  <option value="USD">دلار ($)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">وب‌سایت (اختیاری)</label>
                <input
                  dir="ltr"
                  value={form.website || ''}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none text-left"
                  placeholder="https://example.ir"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">موقعیت مکانی</label>
                <input
                  value={form.location || ''}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="ایران — تهران"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">توضیح کوتاه کسب‌وکار</label>
                <textarea
                  rows={3}
                  value={form.description || ''}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="در دو جمله توضیح دهید چه ارزشی برای مخاطبان خلق می‌کنید..."
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-2">پلتفرم‌های اصلی شما</label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORM_OPTIONS.map((p) => {
                    const selected = (form.creatorProfile?.mainPlatforms || []).includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            creatorProfile: {
                              ...(form.creatorProfile || { experienceLevel: '', expertiseTopics: '', preferredFormats: [], mainPlatforms: [] }),
                              mainPlatforms: toggleArrayItem(form.creatorProfile?.mainPlatforms || [], p.id),
                            },
                          })
                        }
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          selected
                            ? 'bg-[#6366F1] border-[#6366F1] text-white'
                            : 'bg-[#0B1020] border-[#273449] text-[#94A3B8] hover:text-[#F8FAFC]'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">حوزه تخصصی دقیق (نیچ)</label>
                  <input
                    value={form.niche || ''}
                    onChange={(e) => setForm({ ...form, niche: e.target.value })}
                    className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                    placeholder="مثلاً: آموزش هوش مصنوعی کاربردی برای فریلنسرها"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">سطح تجربه</label>
                  <select
                    value={form.creatorProfile?.experienceLevel || 'در حال رشد'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        creatorProfile: {
                          ...(form.creatorProfile || { mainPlatforms: [], expertiseTopics: '', preferredFormats: [], experienceLevel: '' }),
                          experienceLevel: e.target.value,
                        },
                      })
                    }
                    className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  >
                    <option value="تازه‌کار">تازه‌کار (شروع فعالیت)</option>
                    <option value="در حال رشد">در حال رشد (دارای مخاطب اولیه)</option>
                    <option value="حرفه‌ای">حرفه‌ای (دارای محصول و فروش مستمر)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">موضوعات تخصصی کلیدی</label>
                <textarea
                  rows={2}
                  value={form.creatorProfile?.expertiseTopics || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      creatorProfile: {
                        ...(form.creatorProfile || { mainPlatforms: [], experienceLevel: '', preferredFormats: [], expertiseTopics: '' }),
                        expertiseTopics: e.target.value,
                      },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="موضوعاتی که بیشترین تسلط و علاقه را در آن‌ها دارید..."
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">توضیح مخاطب هدف</label>
                <textarea
                  rows={2}
                  value={form.audienceProfile?.description || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      audienceProfile: { ...(form.audienceProfile as NonNullable<Business['audienceProfile']>), description: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="مخاطبان اصلی شما چه کسانی هستند؟"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">بازه سنی مخاطبان</label>
                <input
                  value={form.audienceProfile?.ageRange || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      audienceProfile: { ...(form.audienceProfile as NonNullable<Business['audienceProfile']>), ageRange: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">موقعیت جغرافیایی مخاطبان</label>
                <input
                  value={form.audienceProfile?.location || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      audienceProfile: { ...(form.audienceProfile as NonNullable<Business['audienceProfile']>), location: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">دغدغه‌ها و مشکلات اصلی مخاطب</label>
                <textarea
                  rows={2}
                  value={form.audienceProfile?.painPoints || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      audienceProfile: { ...(form.audienceProfile as NonNullable<Business['audienceProfile']>), painPoints: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">خواسته‌ها و اهداف مخاطب</label>
                <textarea
                  rows={2}
                  value={form.audienceProfile?.goals || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      audienceProfile: { ...(form.audienceProfile as NonNullable<Business['audienceProfile']>), goals: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">لحن برند (Brand Voice)</label>
                <input
                  value={form.brandSettings?.voice || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      brandSettings: { ...(form.brandSettings as NonNullable<Business['brandSettings']>), voice: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="مثلاً: صمیمی، دقیق و بدون اغراق"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">سبک نگارش</label>
                <select
                  value={form.brandSettings?.communicationStyle || 'محاوره‌ای استاندارد'}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      brandSettings: { ...(form.brandSettings as NonNullable<Business['brandSettings']>), communicationStyle: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                >
                  <option value="محاوره‌ای استاندارد">محاوره‌ای استاندارد (مناسب اینستاگرام و تلگرام)</option>
                  <option value="رسمی و تخصصی">رسمی و تخصصی (مناسب لینکدین و مقالات)</option>
                  <option value="ترکیبی آموزشی">ترکیبی آموزشی و الهام‌بخش</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">واژگان و اصطلاحات ترجیحی</label>
                <input
                  value={form.brandSettings?.preferredTerms || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      brandSettings: { ...(form.brandSettings as NonNullable<Business['brandSettings']>), preferredTerms: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">واژگان ممنوعه (کلماتی که نباید استفاده شوند)</label>
                <input
                  value={form.brandSettings?.avoidWords || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      brandSettings: { ...(form.brandSettings as NonNullable<Business['brandSettings']>), avoidWords: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="مثلاً: تضمینی، یک‌شبه، معجزه"
                />
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">هدف اصلی کسب‌وکار در ۹۰ روز آینده</label>
                <input
                  value={form.businessGoals?.primaryObjective || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      businessGoals: { ...(form.businessGoals as NonNullable<Business['businessGoals']>), primaryObjective: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="مثلاً: راه‌اندازی اولین دوره و جذب ۱۰۰۰ مخاطب هدفمند"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">ریتم انتشار محتوا</label>
                <input
                  value={form.businessGoals?.publishingCadence || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      businessGoals: { ...(form.businessGoals as NonNullable<Business['businessGoals']>), publishingCadence: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">هدف رشد مخاطب</label>
                <input
                  value={form.businessGoals?.audienceGoal || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      businessGoals: { ...(form.businessGoals as NonNullable<Business['businessGoals']>), audienceGoal: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">هدف درآمدی ماهانه</label>
                <input
                  value={form.businessGoals?.revenueGoal || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      businessGoals: { ...(form.businessGoals as NonNullable<Business['businessGoals']>), revenueGoal: e.target.value },
                    })
                  }
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-[#94A3B8]">مدل‌های درآمدزایی مورد نظر خود را انتخاب کنید:</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {MONETIZATION_OPTIONS.map((opt) => {
                  const selected = (form.monetizationModels || []).includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          monetizationModels: toggleArrayItem(form.monetizationModels || [], opt.id),
                        })
                      }
                      className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm text-right transition-colors ${
                        selected
                          ? 'bg-[#6366F1]/15 border-[#6366F1] text-[#F8FAFC]'
                          : 'bg-[#0B1020] border-[#273449] text-[#94A3B8] hover:text-[#F8FAFC]'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {selected && <Check className="w-4 h-4 text-[#6366F1] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 7 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[#F8FAFC]">خلاصه پروفایل کسب‌وکار</h3>
                  <p className="text-xs text-[#94A3B8]">
                    این خلاصه پس از تأیید شما به‌عنوان حافظه مشترک در اختیار تمام ۵ ایجنت قرار می‌گیرد.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateAiSummary}
                  disabled={generatingAi}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#11182A] border border-[#6366F1] text-[#F8FAFC] hover:bg-[#6366F1]/20 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {generatingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-[#8B5CF6]" />}
                  <span>{t.onboarding.generateSummaryBtn}</span>
                </button>
              </div>

              <textarea
                rows={5}
                value={form.profileSummary || ''}
                onChange={(e) => setForm({ ...form, profileSummary: e.target.value })}
                className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm leading-relaxed outline-none"
                placeholder="خلاصه کسب‌وکار خود را بنویسید یا دکمه تولید هوشمند را بزنید..."
              />

              {aiInsights && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#273449]">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[#8B5CF6]">فرصت‌های کلیدی پیشنهادی هوش مصنوعی</div>
                    <ul className="space-y-1.5 text-xs text-[#94A3B8] list-disc list-inside">
                      {aiInsights.opportunities.map((op, i) => (
                        <li key={i}>{op}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[#22C55E]">برنامه پیشنهادی هفته اول</div>
                    <ul className="space-y-1.5 text-xs text-[#94A3B8] list-disc list-inside">
                      {aiInsights.plan.map((pl, i) => (
                        <li key={i}>{pl}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer Navigation */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#273449]">
            <div className="flex items-center gap-2">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => persistProgress(step - 1)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#11182A] border border-[#273449] hover:border-[#3B4D6B] text-sm font-medium rounded-lg whitespace-nowrap"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>{t.common.back}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => persistProgress(step)}
                disabled={saving}
                className="px-4 py-2 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] whitespace-nowrap"
              >
                {saving ? 'در حال ذخیره...' : t.onboarding.saveProgressBtn}
              </button>
            </div>

            {step < 7 ? (
              <button
                type="button"
                onClick={() => persistProgress(step + 1)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                <span>{t.common.next}</span>
                <ChevronLeft className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCompleteOnboarding}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 bg-[#22C55E] hover:bg-[#16A34A] text-[#0B1020] text-sm font-bold rounded-lg transition-colors whitespace-nowrap"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{t.onboarding.confirmAndLaunchBtn}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
