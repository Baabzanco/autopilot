import React, { useMemo, useState } from 'react';
import { Info, Plug, RefreshCw, Unplug } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { logActivity, updateIntegrationStatus } from '../services/dataAccess';
import { formatNumber } from '../lib/localization';
import type { Business, Integration, IntegrationStatus } from '../types/domain';
import { ErrorState, StatusIndicator } from '../components/ui/Primitives';

const CATEGORY_LABELS: Record<'all' | 'social' | 'payment' | 'messaging' | 'analytics', string> = {
  all: 'همه سرویس‌ها',
  social: 'شبکه‌های اجتماعی',
  payment: 'درگاه‌های پرداخت',
  messaging: 'پیام‌رسان و ایمیل',
  analytics: 'تحلیل و آمار',
};

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  not_connected: 'متصل نشده',
  connecting: 'در حال اتصال',
  connected: 'متصل',
  expired: 'نیاز به تمدید دسترسی',
  permission_required: 'نیازمند مجوز رسمی API',
  error: 'خطای اتصال',
  disconnected: 'قطع‌شده توسط مالک',
};

export function IntegrationsPage({
  business,
  ownerId,
  integrations,
}: {
  business: Business;
  ownerId: string;
  integrations: Integration[];
}) {
  const { locale } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [categoryFilter, setCategoryFilter] = useState<'all' | 'social' | 'payment' | 'messaging' | 'analytics'>('all');
  const [editing, setEditing] = useState<Integration | null>(null);
  const [accountHandle, setAccountHandle] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (categoryFilter === 'all') return integrations;
    return integrations.filter((i) => i.category === categoryFilter);
  }, [integrations, categoryFilter]);

  const connectedCount = integrations.filter((i) => i.connectionStatus === 'connected').length;

  const handleMarkPermissionRequired = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const handle = accountHandle.trim();
      const note =
        statusNote.trim() ||
        'شناسه حساب ثبت شد؛ برای همگام‌سازی خودکار، پیکربندی توکن رسمی OAuth در سرور مورد نیاز است.';
      await updateIntegrationStatus(business.id, editing.id, {
        accountHandle: handle,
        connectionStatus: handle ? 'permission_required' : 'not_connected',
        statusNote: note,
      });
      await logActivity(business.id, ownerId, {
        actorType: 'owner',
        actorName: 'مالک کسب‌وکار',
        action: 'به‌روزرسانی وضعیت یکپارچه‌سازی',
        entityType: 'integration',
        entityId: editing.id,
        details: `اطلاعات اتصال ${editing.displayName || editing.provider} به‌روزرسانی شد.`,
      });
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در به‌روزرسانی وضعیت اتصال');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (item: Integration) => {
    setError(null);
    try {
      await updateIntegrationStatus(business.id, item.id, {
        connectionStatus: 'disconnected',
        accountHandle: '',
        statusNote: 'اتصال توسط مالک قطع شد.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در قطع اتصال');
    }
  };

  return (
    <div className="space-y-6">
      {/* Transparency Notice */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-[#8B5CF6] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">مدیریت اتصالات واقعی و شفافیت API</h2>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              هیچ اتصالی به‌صورت نمایشی یا جعلی «متصل» نمایش داده نمی‌شود. تا زمان تنظیم اعتبارنامه‌های رسمی OAuth یا درگاه بانکی،
              محتواها در استودیو و تقویم برای انتشار دستی آماده می‌شوند و سفارش‌ها در حالت آزمایشی ثبت می‌گردند.
            </p>
          </div>
        </div>
        <div className="text-xs text-[#94A3B8] tabular-nums whitespace-nowrap shrink-0">
          {formatNumber(connectedCount, locale, numeralStyle)} از {formatNumber(integrations.length, locale, numeralStyle)} متصل
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              categoryFilter === cat
                ? 'bg-[#6366F1] text-white'
                : 'bg-[#151E33] border border-[#273449] text-[#94A3B8] hover:text-[#F8FAFC]'
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {error && <ErrorState message={error} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#F8FAFC]">
                    {item.displayName || item.provider}
                  </h3>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5">
                    {item.category ? CATEGORY_LABELS[item.category] : 'سرویس خارجی'}
                    {item.accountHandle ? ` · ${item.accountHandle}` : ''}
                  </div>
                </div>
                <StatusIndicator
                  status={item.connectionStatus}
                  label={STATUS_LABELS[item.connectionStatus] || item.connectionStatus}
                />
              </div>

              <p className="text-xs text-[#94A3B8] leading-relaxed">
                {item.statusNote || 'متصل نشده — آماده پیکربندی اعتبارنامه رسمی.'}
              </p>

              {item.scopes && item.scopes.length > 0 && (
                <div className="text-[11px] text-[#94A3B8]" dir="ltr">
                  Scopes: {item.scopes.join(' · ')}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[#273449] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(item);
                  setAccountHandle(item.accountHandle || '');
                  setStatusNote(item.statusNote || '');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] text-xs font-medium rounded-lg"
              >
                <Plug className="w-3.5 h-3.5 text-[#8B5CF6]" />
                <span>تنظیم شناسه و وضعیت</span>
              </button>

              {item.connectionStatus !== 'not_connected' && item.connectionStatus !== 'disconnected' && (
                <button
                  type="button"
                  onClick={() => handleDisconnect(item)}
                  className="inline-flex items-center gap-1 text-xs text-[#EF4444] hover:underline"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  <span>قطع اتصال</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Configure Handle / Official Requirements Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleMarkPermissionRequired}
            className="bg-[#151E33] border border-[#273449] rounded-xl max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-[#8B5CF6]" />
              <h3 className="text-base font-semibold text-[#F8FAFC]">
                پیکربندی {editing.displayName || editing.provider}
              </h3>
            </div>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              می‌توانید نام کاربری یا شناسه کانال/درگاه خود را ثبت کنید تا در پیش‌نمایش‌ها نمایش داده شود. اتصال خودکار تنها پس از احراز هویت رسمی OAuth فعال می‌شود.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1">شناسه حساب یا کانال (مثلاً @username)</label>
                <input
                  dir="ltr"
                  value={accountHandle}
                  onChange={(e) => setAccountHandle(e.target.value)}
                  placeholder="@creator_handle"
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none text-left"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1">یادداشت وضعیت اتصال</label>
                <textarea
                  rows={3}
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 text-xs text-[#94A3B8]"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg"
              >
                ذخیره اطلاعات اتصال
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
