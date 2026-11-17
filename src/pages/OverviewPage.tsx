import React from 'react';
import { Bot, ArrowUpLeft } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { formatCurrency, formatDigits, formatJalaliDateTime, formatNumber } from '../lib/localization';
import type {
  ActivityLog,
  Agent,
  Approval,
  Business,
  Campaign,
  ContentItem,
  Integration,
  NavSection,
  Order,
  Task,
} from '../types/domain';
import { EmptyState, MetricCard, StatusIndicator } from '../components/ui/Primitives';

export function OverviewPage({
  business,
  agents,
  tasks,
  content,
  approvals,
  orders,
  campaigns,
  integrations,
  activityLogs,
  onNavigate,
  onOpenAiManager,
}: {
  business: Business;
  agents: Agent[];
  tasks: Task[];
  content: ContentItem[];
  approvals: Approval[];
  orders: Order[];
  campaigns: Campaign[];
  integrations: Integration[];
  activityLogs: ActivityLog[];
  onNavigate: (nav: NavSection) => void;
  onOpenAiManager: () => void;
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const publishedCount = content.filter((c) => c.status === 'published').length;
  const draftCount = content.filter((c) => c.status === 'draft' || c.status === 'idea').length;
  const scheduledCount = content.filter((c) => c.status === 'scheduled').length;
  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;

  const activeAgents = agents.filter((a) => a.enabled).length;
  const activeTasks = tasks.filter((tk) => ['created', 'assigned', 'in_progress', 'awaiting_input'].includes(tk.status)).length;
  const completedTasks = tasks.filter((tk) => tk.status === 'completed').length;
  const failedTasks = tasks.filter((tk) => tk.status === 'failed').length;
  const totalAiCost = agents.reduce((acc, a) => acc + (a.estimatedCostUsd || 0), 0);

  const paidOrders = orders.filter((o) => o.paymentStatus === 'paid');
  const totalRevenue = paidOrders.reduce((acc, o) => acc + (o.total || 0), 0);
  const activeCampaigns = campaigns.filter((c) => c.status === 'active' || c.status === 'approved').length;

  const hasConnectedSocial = integrations.some(
    (i) => i.category === 'social' && i.connectionStatus === 'connected'
  );

  return (
    <div className="space-y-8">
      {/* Business Header Strip */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-[#94A3B8]">
            {business.category || 'کسب‌وکار محتوایی'} · {business.niche || 'حوزه تخصصی تعریف‌نشده'}
          </div>
          <h2 className="text-lg font-bold text-[#F8FAFC]">سلام، {business.creatorName || business.name}</h2>
          <p className="text-xs text-[#94A3B8] max-w-2xl leading-relaxed">
            {business.profileSummary || 'خلاصه کسب‌وکار شما در حافظه مشترک ایجنت‌ها ذخیره شده است.'}
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onOpenAiManager}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            <Bot className="w-4 h-4" />
            <span>از مدیر هوشمند بپرسید</span>
          </button>
          <button
            onClick={() => onNavigate('approvals')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#11182A] border border-[#273449] hover:border-[#3B4D6B] text-xs font-medium text-[#F8FAFC] rounded-lg whitespace-nowrap"
          >
            <span>مرکز تأییدها</span>
            <ArrowUpLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Section 1: Business Summary */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#F8FAFC]">خلاصه وضعیت کسب‌وکار</h3>
          <span className="text-xs text-[#94A3B8]">منبع: رکوردهای واقعی ثبت‌شده در سیستم</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="محتوای منتشرشده / زمان‌بندی‌شده"
            value={`${formatNumber(publishedCount, locale, numeralStyle)} / ${formatNumber(scheduledCount, locale, numeralStyle)}`}
            source="استودیو و تقویم محتوا"
            period="کل دوره"
          />
          <MetricCard
            label="پیش‌نویس‌ها / در انتظار تأیید"
            value={`${formatNumber(draftCount, locale, numeralStyle)} / ${formatNumber(pendingApprovals, locale, numeralStyle)}`}
            source="مرکز تأییدها"
            period="وضعیت فعلی"
          />
          <MetricCard
            label="فروش و درآمد ثبت‌شده"
            value={formatCurrency(totalRevenue, business.currency, locale, numeralStyle)}
            source={`${formatNumber(paidOrders.length, locale, numeralStyle)} سفارش موفق`}
            period="کل دوره"
          />
          <MetricCard
            label="مخاطبان شبکه اجتماعی و نرخ تعامل"
            value={hasConnectedSocial ? 'متصل' : t.common.unavailable}
            source={hasConnectedSocial ? 'API پلتفرم متصل' : 'حساب اجتماعی متصل نشده'}
            period="نیازمند اتصال رسمی"
            unavailable={!hasConnectedSocial}
          />
        </div>
      </section>

      {/* Section 2: AI Workforce Summary */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#F8FAFC]">وضعیت تیم هوش مصنوعی</h3>
          <button
            onClick={() => onNavigate('workforce')}
            className="text-xs text-[#8B5CF6] hover:underline whitespace-nowrap"
          >
            مدیریت ایجنت‌ها
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard
            label="ایجنت‌های فعال"
            value={formatNumber(activeAgents, locale, numeralStyle)}
            source="تیم هوشمند"
            period="اکنون"
          />
          <MetricCard
            label="وظایف در جریان"
            value={formatNumber(activeTasks, locale, numeralStyle)}
            source="صف وظایف"
            period="اکنون"
          />
          <MetricCard
            label="وظایف تکمیل‌شده"
            value={formatNumber(completedTasks, locale, numeralStyle)}
            source="تاریخچه وظایف"
            period="کل دوره"
          />
          <MetricCard
            label="وظایف ناموفق"
            value={formatNumber(failedTasks, locale, numeralStyle)}
            source="گزارش خطاها"
            period="کل دوره"
          />
          <MetricCard
            label="هزینه تخمینی هوش مصنوعی"
            value={`$${formatDigits(totalAiCost.toFixed(4), numeralStyle)}`}
            source="مصرف توکن سرور"
            period={t.common.estimated}
          />
        </div>
      </section>

      {/* Section 3: Recent Content & Chronological Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#273449] pb-3">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">آخرین محتواها</h3>
            <button
              onClick={() => onNavigate('content')}
              className="text-xs text-[#8B5CF6] hover:underline"
            >
              باز کردن استودیو
            </button>
          </div>
          {content.length === 0 ? (
            <EmptyState
              title="هنوز محتوایی ثبت نشده است"
              description="اولین پیش‌نویس محتوا را در استودیو محتوا با کمک ایجنت محتوا بسازید."
              actionLabel="ساخت محتوا"
              onAction={() => onNavigate('content')}
            />
          ) : (
            <div className="divide-y divide-[#273449]">
              {content.slice(0, 5).map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#F8FAFC] truncate">{item.title}</div>
                    <div className="text-xs text-[#94A3B8] mt-0.5">
                      {t.platforms[item.platform]} · {t.contentTypes[item.contentType]}
                      {item.aiGenerated ? ` · ${t.common.aiGenerated}` : ''}
                    </div>
                  </div>
                  <StatusIndicator status={item.status} label={t.statuses[item.status] || item.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#273449] pb-3">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">رویدادهای اخیر کسب‌وکار</h3>
            <span className="text-xs text-[#94A3B8] tabular-nums">
              {formatNumber(activeCampaigns, locale, numeralStyle)} کمپین فعال
            </span>
          </div>
          {activityLogs.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#94A3B8]">
              رویدادهای کسب‌وکار و ایجنت‌ها به‌صورت خودکار در اینجا ثبت می‌شوند.
            </div>
          ) : (
            <div className="divide-y divide-[#273449] max-h-[340px] overflow-y-auto">
              {activityLogs.slice(0, 8).map((log) => (
                <div key={log.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-[#F8FAFC]">
                      {log.action} · <span className="text-[#94A3B8]">{log.actorName || log.actorType}</span>
                    </span>
                    <span className="text-[11px] text-[#94A3B8] tabular-nums shrink-0">
                      {formatJalaliDateTime(log.createdAt, locale, numeralStyle)}
                    </span>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">{log.details}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
