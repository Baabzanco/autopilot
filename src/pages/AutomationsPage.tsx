import React, { useState } from 'react';
import { Loader2, Play, Power, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { generateAnalyticsReport, generateContentDraft } from '../services/apiClient';
import {
  createAutomation,
  createContentItem,
  deleteAutomation,
  logActivity,
  recordAutomationRun,
  saveAnalyticsReport,
  updateAutomation,
} from '../services/dataAccess';
import { formatJalaliDateTime, formatNumber } from '../lib/localization';
import type { Automation, AutomationRun, AutomationTriggerType, Business, ContentItem, Order } from '../types/domain';
import { ConfirmationDialog, ErrorState, StatusIndicator } from '../components/ui/Primitives';

const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  new_content_idea: 'هنگام ثبت ایده محتوای جدید',
  new_order: 'هنگام ثبت سفارش موفق',
  weekly_review: 'گزارش هفتگی کسب‌وکار',
  low_content_activity: 'کاهش فعالیت تولید محتوا',
  manual: 'اجرای دستی توسط مالک',
};

export function AutomationsPage({
  business,
  ownerId,
  automations,
  runs,
  content,
  orders,
}: {
  business: Business;
  ownerId: string;
  automations: Automation[];
  runs: AutomationRun[];
  content: ContentItem[];
  orders: Order[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('manual');
  const [actionSummary, setActionSummary] = useState('تولید پیش‌نویس محتوا یا گزارش داخلی (بدون انتشار خودکار)');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createAutomation(business.id, ownerId, {
      name: name.trim(),
      description: description.trim(),
      triggerType,
      actionSummary: actionSummary.trim(),
      enabled: true,
      requiresApprovalForExternal: true,
    });
    setName('');
    setDescription('');
    setShowAdd(false);
  };

  const handleRunAutomation = async (auto: Automation) => {
    if (!auto.enabled) {
      setError(`خودکارسازی «${auto.name}» غیرفعال است.`);
      return;
    }
    setRunningId(auto.id);
    setError(null);
    try {
      let summary = '';
      if (auto.triggerType === 'weekly_review') {
        const res = await generateAnalyticsReport({
          reportType: 'weekly',
          business,
          metricsSnapshot: {
            totalContent: content.length,
            published: content.filter((c) => c.status === 'published').length,
            orders: orders.length,
          },
        });
        await saveAnalyticsReport(business.id, ownerId, {
          reportType: 'weekly',
          title: res.title,
          summary: res.summary,
          dataSourceNote: res.dataSourceNote,
        });
        summary = `گزارش «${res.title}» تولید و در بخش تحلیل‌ها ذخیره شد.`;
      } else {
        const res = await generateContentDraft({
          mode: 'idea',
          promptInput: `تولید یک پیش‌نویس پیشنهادی بر اساس پروفایل کسب‌وکار ${business.name} و جای خالی تقویم`,
          platform: 'instagram',
          contentType: 'post',
          objective: 'حفظ استمرار انتشار محتوا',
          tone: business.brandSettings?.voice || 'صمیمی',
          language: 'fa',
          business,
        });
        await createContentItem(business.id, ownerId, {
          title: res.title,
          platform: 'instagram',
          contentType: 'post',
          language: 'fa',
          caption: res.caption,
          script: res.script,
          cta: res.cta,
          hashtags: res.hashtags,
          status: 'draft',
          aiGenerated: true,
          aiModel: 'gemini-4-hydrogen',
        });
        summary = `پیش‌نویس «${res.title}» در استودیو محتوا ذخیره شد (منتشر نشده).`;
      }

      await recordAutomationRun(business.id, ownerId, auto, 'success', summary);
      await logActivity(business.id, ownerId, {
        actorType: 'system',
        actorName: 'مرکز خودکارسازی',
        action: 'اجرای گردش‌کار داخلی',
        entityType: 'automation',
        entityId: auto.id,
        details: summary,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطا در اجرای خودکارسازی';
      setError(msg);
      await recordAutomationRun(business.id, ownerId, auto, 'failed', 'اجرا ناموفق بود.', msg);
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#94A3B8]">
          گردش‌کارهای داخلی بدون انتشار خودکار اجرا می‌شوند و اقدامات خارجی همچنان نیازمند تأیید شما هستند.
        </p>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg"
        >
          <Plus className="w-4 h-4" />
          <span>ساخت گردش‌کار جدید</span>
        </button>
      </div>

      {error && <ErrorState message={error} />}

      {showAdd && (
        <form onSubmit={handleCreate} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="نام گردش‌کار *"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            />
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input
              value={actionSummary}
              onChange={(e) => setActionSummary(e.target.value)}
              placeholder="خلاصه اقدام"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2"
            />
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="توضیحات..."
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-[#94A3B8]">انصراف</button>
            <button type="submit" className="px-4 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg">ایجاد</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {automations.map((auto) => (
          <div key={auto.id} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#F8FAFC]">{auto.name}</h3>
                <StatusIndicator status={auto.enabled ? 'active' : 'disabled'} label={auto.enabled ? 'فعال' : 'غیرفعال'} />
              </div>
              <div className="text-[11px] text-[#8B5CF6]">{TRIGGER_LABELS[auto.triggerType]}</div>
              <p className="text-xs text-[#94A3B8] leading-relaxed">{auto.description}</p>
            </div>

            <div className="pt-3 border-t border-[#273449] space-y-2.5">
              <div className="text-[11px] text-[#94A3B8] tabular-nums">
                دفعات اجرا: {formatNumber(auto.runCount ?? 0, locale, numeralStyle)}
                {auto.lastExecutedAt ? ` · آخرین اجرا: ${formatJalaliDateTime(auto.lastExecutedAt, locale, numeralStyle)}` : ''}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRunAutomation(auto)}
                    disabled={!auto.enabled || runningId === auto.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                  >
                    {runningId === auto.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>اجرای دستی</span>
                  </button>
                  <button
                    onClick={() => updateAutomation(business.id, auto.id, { enabled: !auto.enabled })}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#11182A] border border-[#273449] text-xs rounded-lg"
                  >
                    <Power className="w-3 h-3" />
                    <span>{auto.enabled ? 'توقف' : 'فعال'}</span>
                  </button>
                </div>
                <button onClick={() => setDeleteTarget(auto)} className="text-[#94A3B8] hover:text-[#EF4444]">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Run History */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-[#F8FAFC]">تاریخچه اجرای گردش‌کارها</h3>
        {runs.length === 0 ? (
          <div className="text-xs text-[#94A3B8] py-4">هنوز سابقه‌ای ثبت نشده است.</div>
        ) : (
          <div className="divide-y divide-[#273449]">
            {runs.slice(0, 10).map((r) => (
              <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-medium text-[#F8FAFC]">{r.automationName}</div>
                  <div className="text-[#94A3B8] mt-0.5">{r.outputSummary || r.error}</div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusIndicator status={r.status} label={r.status === 'success' ? 'موفق' : 'ناموفق'} />
                  <span className="text-[11px] text-[#94A3B8] tabular-nums">{formatJalaliDateTime(r.createdAt, locale, numeralStyle)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="حذف خودکارسازی"
        description={t.common.confirmDelete}
        confirmLabel="حذف"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteAutomation(business.id, deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
