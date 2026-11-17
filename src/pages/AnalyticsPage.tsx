import React, { useState } from 'react';
import { FileBarChart, Loader2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { generateAnalyticsReport } from '../services/apiClient';
import { saveAnalyticsReport } from '../services/dataAccess';
import { formatCurrency, formatDigits, formatJalaliDateTime, formatNumber } from '../lib/localization';
import type {
  Agent,
  AnalyticsReport,
  Approval,
  Business,
  ContentItem,
  Integration,
  Order,
  ReportType,
  Task,
} from '../types/domain';
import { ErrorState, MetricCard } from '../components/ui/Primitives';

export function AnalyticsPage({
  business,
  ownerId,
  content,
  orders,
  tasks,
  approvals,
  agents,
  integrations,
  reports,
}: {
  business: Business;
  ownerId: string;
  content: ContentItem[];
  orders: Order[];
  tasks: Task[];
  approvals: Approval[];
  agents: Agent[];
  integrations: Integration[];
  reports: AnalyticsReport[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [reportType, setReportType] = useState<ReportType>('weekly');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paidOrders = orders.filter((o) => o.paymentStatus === 'paid');
  const refundedOrders = orders.filter((o) => o.paymentStatus === 'refunded');
  const grossRevenue = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
  const refundTotal = refundedOrders.reduce((s, o) => s + (o.total || 0), 0);
  const netRevenue = Math.max(0, grossRevenue - refundTotal);

  const completedTasks = tasks.filter((tk) => tk.status === 'completed').length;
  const failedTasks = tasks.filter((tk) => tk.status === 'failed').length;
  const approvedCount = approvals.filter((a) => a.status === 'approved').length;
  const resolvedApprovals = approvals.filter((a) => ['approved', 'rejected'].includes(a.status)).length;
  const approvalRate = resolvedApprovals > 0 ? Math.round((approvedCount / resolvedApprovals) * 100) : 0;
  const totalAiCost = agents.reduce((s, a) => s + (a.estimatedCostUsd || 0), 0);

  const connectedSocialCount = integrations.filter(
    (i) => i.category === 'social' && i.connectionStatus === 'connected'
  ).length;

  const platformCounts = ['instagram', 'telegram', 'youtube', 'linkedin', 'tiktok', 'x'].map((p) => ({
    platform: p,
    count: content.filter((c) => c.platform === p).length,
  }));
  const maxPlatformCount = Math.max(1, ...platformCounts.map((x) => x.count));

  const handleGenerateReport = async () => {
    setGenerating(true);
    setError(null);
    try {
      const snapshot = {
        totalContent: content.length,
        publishedContent: content.filter((c) => c.status === 'published').length,
        scheduledContent: content.filter((c) => c.status === 'scheduled').length,
        totalOrders: orders.length,
        paidOrders: paidOrders.length,
        netRevenue,
        currency: business.currency,
        completedAiTasks: completedTasks,
        failedAiTasks: failedTasks,
        approvalRatePercent: approvalRate,
        estimatedAiCostUsd: totalAiCost,
        connectedSocialAccounts: connectedSocialCount,
      };
      const res = await generateAnalyticsReport({
        reportType,
        business,
        metricsSnapshot: snapshot,
      });
      await saveAnalyticsReport(business.id, ownerId, {
        reportType,
        title: res.title,
        summary: res.summary,
        dataSourceNote: res.dataSourceNote,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تولید گزارش تحلیلی');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Real Business & AI Metrics */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#F8FAFC]">شاخص‌های واقعی کسب‌وکار و درآمد</h2>
          <span className="text-xs text-[#94A3B8]">بدون داده‌سازی — مبتنی بر سفارش‌ها و وظایف ثبت‌شده</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="درآمد خالص ثبت‌شده"
            value={formatCurrency(netRevenue, business.currency, locale, numeralStyle)}
            source={`${formatNumber(paidOrders.length, locale, numeralStyle)} سفارش موفق`}
            period="کل دوره"
          />
          <MetricCard
            label="نرخ تأیید انسانی اقدامات"
            value={resolvedApprovals > 0 ? `${formatDigits(approvalRate, numeralStyle)}٪` : t.common.unavailable}
            source="مرکز تأییدها"
            period={`${formatNumber(resolvedApprovals, locale, numeralStyle)} بررسی‌شده`}
            unavailable={resolvedApprovals === 0}
          />
          <MetricCard
            label="عملکرد وظایف AI"
            value={`${formatNumber(completedTasks, locale, numeralStyle)} موفق / ${formatNumber(failedTasks, locale, numeralStyle)} خطا`}
            source="تیم هوشمند"
            period="کل دوره"
          />
          <MetricCard
            label="آمار بازدید و فالوور شبکه‌های اجتماعی"
            value={connectedSocialCount > 0 ? 'آماده همگام‌سازی' : t.common.unavailable}
            source="اتصال‌های خارجی"
            period="متصل نشده"
            unavailable={connectedSocialCount === 0}
          />
        </div>
      </section>

      {/* Content Distribution Bar Chart (Grounded in Real Content Records) */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#273449] pb-3">
          <h3 className="text-sm font-semibold text-[#F8FAFC]">توزیع محتوای تولیدشده به تفکیک پلتفرم</h3>
          <span className="text-xs text-[#94A3B8] tabular-nums">
            مجموع: {formatNumber(content.length, locale, numeralStyle)} محتوا
          </span>
        </div>
        <div className="space-y-3">
          {platformCounts.map((row) => {
            const pct = Math.round((row.count / maxPlatformCount) * 100);
            return (
              <div key={row.platform} className="grid grid-cols-12 items-center gap-3 text-xs">
                <div className="col-span-3 sm:col-span-2 text-[#94A3B8] truncate">
                  {t.platforms[row.platform as keyof typeof t.platforms] || row.platform}
                </div>
                <div className="col-span-7 sm:col-span-9 h-2.5 bg-[#0B1020] rounded-full overflow-hidden">
                  <svg className="w-full h-full block" viewBox="0 0 100 10" preserveAspectRatio="none">
                    <rect
                      x={100 - (row.count > 0 ? Math.max(4, pct) : 0)}
                      y="0"
                      width={row.count > 0 ? Math.max(4, pct) : 0}
                      height="10"
                      rx="5"
                      fill="#6366F1"
                    />
                  </svg>
                </div>
                <div className="col-span-2 sm:col-span-1 text-left tabular-nums font-semibold text-[#F8FAFC]">
                  {formatNumber(row.count, locale, numeralStyle)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Saved AI Reports */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#273449] pb-3">
          <div>
            <h3 className="text-sm font-semibold text-[#F8FAFC]">گزارش‌های تحلیلی ذخیره‌شده</h3>
            <p className="text-xs text-[#94A3B8]">تولید گزارش واقعی بر پایه آمار موجود با هوش مصنوعی</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              <option value="daily">گزارش روزانه</option>
              <option value="weekly">گزارش هفتگی</option>
              <option value="monthly">گزارش ماهانه</option>
              <option value="content_performance">عملکرد محتوا</option>
              <option value="business_performance">عملکرد کل کسب‌وکار</option>
            </select>
            <button
              onClick={handleGenerateReport}
              disabled={generating}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4" />}
              <span>تولید و ذخیره گزارش</span>
            </button>
          </div>
        </div>

        {error && <ErrorState message={error} />}

        {reports.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#94A3B8]">
            هنوز گزارشی تولید نشده است. از دکمه بالا اولین گزارش تحلیلی را بسازید.
          </div>
        ) : (
          <div className="divide-y divide-[#273449]">
            {reports.map((rep) => (
              <div key={rep.id} className="py-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-[#F8FAFC]">{rep.title}</div>
                  <div className="text-[11px] text-[#94A3B8] tabular-nums">
                    {formatJalaliDateTime(rep.createdAt, locale, numeralStyle)}
                  </div>
                </div>
                <p className="text-xs text-[#F8FAFC] leading-relaxed whitespace-pre-wrap">{rep.summary}</p>
                {rep.dataSourceNote && (
                  <div className="text-[11px] text-[#94A3B8]">منبع: {rep.dataSourceNote}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
