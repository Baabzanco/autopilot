import React, { useState } from 'react';
import { Loader2, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { generateCampaignDraft } from '../services/apiClient';
import {
  createApprovalRequest,
  createCampaign,
  deleteCampaign,
  updateCampaign,
} from '../services/dataAccess';
import { formatCurrency } from '../lib/localization';
import type { Business, Campaign, CampaignType, Product } from '../types/domain';
import { ConfirmationDialog, EmptyState, ErrorState, StatusIndicator } from '../components/ui/Primitives';

const CAMPAIGN_TYPES: Record<CampaignType, string> = {
  product_promotion: 'معرفی و فروش محصول',
  audience_growth: 'رشد مخاطب',
  content_launch: 'لانچ سری محتوا',
  affiliate: 'بازاریابی پورسانتی',
  brand_partnership: 'همکاری با برند',
  retention: 'حفظ و وفادارسازی مشتریان',
};

export function CampaignsPage({
  business,
  ownerId,
  campaigns,
  products,
}: {
  business: Business;
  ownerId: string;
  campaigns: Campaign[];
  products: Product[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [campaignType, setCampaignType] = useState<CampaignType>('product_promotion');
  const [objective, setObjective] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [relatedProductId, setRelatedProductId] = useState('');
  const [budget, setBudget] = useState('0');
  const [aiGoalPrompt, setAiGoalPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  const handleAiDraft = async () => {
    if (!aiGoalPrompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const product = products.find((p) => p.id === relatedProductId);
      const res = await generateCampaignDraft({
        goalPrompt: aiGoalPrompt,
        campaignType,
        product,
        business,
      });
      setName(res.name);
      setObjective(`${res.objective}\n\nپیام‌های کلیدی:\n${res.keyMessages.map((m) => `- ${m}`).join('\n')}`);
      setTargetAudience(res.targetAudience);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در طراحی کمپین');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createCampaign(business.id, ownerId, {
      name: name.trim(),
      campaignType,
      objective: objective.trim(),
      targetAudience: targetAudience.trim(),
      platforms: ['instagram', 'telegram'],
      relatedProductId,
      budget: Math.max(0, Number(budget) || 0),
      currency: business.currency || 'IRT',
      status: 'draft',
    });
    setName('');
    setObjective('');
    setTargetAudience('');
    setShowAdd(false);
  };

  const handleSubmitApproval = async (cmp: Campaign) => {
    await updateCampaign(business.id, cmp.id, { status: 'in_review' });
    await createApprovalRequest(business.id, ownerId, {
      category: 'campaign_launch',
      actionTitle: `تأیید راه‌اندازی کمپین: ${cmp.name}`,
      requestingAgentName: 'ایجنت فروش و کمپین',
      targetPlatform: (cmp.platforms || []).join('، '),
      reason: 'اجرای کمپین تبلیغاتی و هزینه نیازمند تأیید صریح مالک است.',
      payloadSummary: `نام کمپین: ${cmp.name}\nنوع: ${CAMPAIGN_TYPES[cmp.campaignType]}\nبودجه: ${formatCurrency(cmp.budget || 0, cmp.currency || business.currency, locale, numeralStyle)}\nهدف: ${cmp.objective}`,
      relatedEntityType: 'campaign',
      relatedEntityId: cmp.id,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#F8FAFC]">مدیریت کمپین‌های بازاریابی</h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg"
        >
          <Plus className="w-4 h-4" />
          <span>کمپین جدید</span>
        </button>
      </div>

      {error && <ErrorState message={error} />}

      {showAdd && (
        <form onSubmit={handleCreate} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
          <div className="bg-[#11182A] border border-[#273449] rounded-lg p-3.5 space-y-2.5">
            <div className="text-xs font-medium text-[#8B5CF6]">پیشنهاد طرح کمپین با هوش مصنوعی</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={aiGoalPrompt}
                onChange={(e) => setAiGoalPrompt(e.target.value)}
                placeholder="هدف کمپین را توضیح دهید (مثلاً: کمپین ۷ روزه فروش دوره جدید در اینستاگرام و تلگرام)"
                className="flex-1 bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              />
              <button
                type="button"
                onClick={handleAiDraft}
                disabled={generating || !aiGoalPrompt.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] text-white text-xs font-medium rounded-lg whitespace-nowrap"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>طراحی با AI</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="نام کمپین *"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            />
            <select
              value={campaignType}
              onChange={(e) => setCampaignType(e.target.value as CampaignType)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              {Object.entries(CAMPAIGN_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={relatedProductId}
              onChange={(e) => setRelatedProductId(e.target.value)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              <option value="">بدون محصول مرتبط</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="بودجه تخمینی"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none tabular-nums"
            />
            <input
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="مخاطب هدف کمپین"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2"
            />
            <textarea
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="شرح هدف و پیام‌های کلیدی..."
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-[#94A3B8]">انصراف</button>
            <button type="submit" className="px-4 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg">ذخیره کمپین</button>
          </div>
        </form>
      )}

      {campaigns.length === 0 ? (
        <EmptyState
          title="کمپینی ثبت نشده است"
          description="کمپین‌های معرفی محصول یا رشد مخاطب را بسازید و پیش از اجرا برای تأیید ارسال کنید."
          actionLabel="ساخت اولین کمپین"
          onAction={() => setShowAdd(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map((cmp) => (
            <div key={cmp.id} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#F8FAFC]">{cmp.name}</h3>
                  <div className="text-xs text-[#94A3B8] mt-0.5">
                    {CAMPAIGN_TYPES[cmp.campaignType]} · بودجه: {formatCurrency(cmp.budget || 0, cmp.currency || business.currency, locale, numeralStyle)}
                  </div>
                </div>
                <StatusIndicator status={cmp.status} label={t.statuses[cmp.status] || cmp.status} />
              </div>

              <p className="text-xs text-[#94A3B8] whitespace-pre-wrap leading-relaxed line-clamp-4">
                {cmp.objective || 'بدون توضیح'}
              </p>

              <div className="flex items-center justify-between pt-3 border-t border-[#273449]">
                {cmp.status === 'draft' ? (
                  <button
                    onClick={() => handleSubmitApproval(cmp)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6366F1] text-white text-xs font-medium rounded-lg"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>ارسال برای تأیید اجرا</span>
                  </button>
                ) : (
                  <span className="text-xs text-[#94A3B8]">وضعیت: {t.statuses[cmp.status] || cmp.status}</span>
                )}
                <button
                  onClick={() => setDeleteTarget(cmp)}
                  className="text-[#94A3B8] hover:text-[#EF4444]"
                  aria-label="حذف کمپین"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="حذف کمپین"
        description={t.common.confirmDelete}
        confirmLabel="حذف"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteCampaign(business.id, deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
