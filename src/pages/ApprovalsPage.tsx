import React, { useMemo, useState } from 'react';
import { CheckCircle2, Edit3, FileWarning, Hash, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { verifyApprovalExecution } from '../services/apiClient';
import { createApprovalRequest, resolveApprovalRequest } from '../services/dataAccess';
import { formatDigits, formatJalaliDateTime, formatNumber } from '../lib/localization';
import type { Approval, ApprovalCategory, ApprovalStatus, Business } from '../types/domain';
import { EmptyState, ErrorState, StatusIndicator } from '../components/ui/Primitives';

const CATEGORY_LABELS: Record<ApprovalCategory, string> = {
  content_publication: 'انتشار محتوا',
  social_message: 'پیام در شبکه اجتماعی',
  marketing_email: 'ایمیل بازاریابی',
  price_change: 'تغییر قیمت محصول',
  campaign_launch: 'شروع کمپین',
  customer_reply: 'پاسخ به مشتری',
  external_integration: 'اتصال سرویس خارجی',
  other: 'سایر اقدامات',
};

type FilterTab = 'pending' | 'changes_requested' | 'resolved' | 'all';

export function ApprovalsPage({
  business,
  ownerId,
  approvals,
}: {
  business: Business;
  ownerId: string;
  approvals: Approval[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [tab, setTab] = useState<FilterTab>('pending');
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [editingApproval, setEditingApproval] = useState<Approval | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPayload, setEditPayload] = useState('');

  const counts = useMemo(() => {
    const pending = approvals.filter((a) => a.status === 'pending').length;
    const changes = approvals.filter((a) => a.status === 'changes_requested').length;
    const resolved = approvals.filter((a) =>
      ['approved', 'rejected', 'expired'].includes(a.status)
    ).length;
    return { pending, changes, resolved, all: approvals.length };
  }, [approvals]);

  const filtered = useMemo(() => {
    if (tab === 'pending') return approvals.filter((a) => a.status === 'pending');
    if (tab === 'changes_requested') return approvals.filter((a) => a.status === 'changes_requested');
    if (tab === 'resolved') {
      return approvals.filter((a) => ['approved', 'rejected', 'expired'].includes(a.status));
    }
    return approvals;
  }, [approvals, tab]);

  const handleDecision = async (
    approval: Approval,
    decision: 'approved' | 'rejected' | 'changes_requested'
  ) => {
    setBusyId(approval.id);
    setError(null);
    setFeedback(null);
    try {
      const note = (notesById[approval.id] ?? '').trim();
      await resolveApprovalRequest(business.id, ownerId, approval, decision, note);
      setFeedback(
        decision === 'approved'
          ? `درخواست «${approval.actionTitle}» با موفقیت تأیید و در تاریخچه ممیزی ثبت شد.`
          : decision === 'rejected'
          ? `درخواست «${approval.actionTitle}» رد شد و هیچ اقدام خارجی انجام نگرفت.`
          : `درخواست اصلاح برای «${approval.actionTitle}» ثبت شد.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت تصمیم تأیید');
    } finally {
      setBusyId(null);
    }
  };

  const handleVerifyIntegrityGate = async (approval: Approval) => {
    setBusyId(approval.id);
    setError(null);
    setFeedback(null);
    try {
      const res = await verifyApprovalExecution({
        business,
        approvalId: approval.id,
        approvalStatus: approval.status,
        expectedPayloadHash: approval.payloadHash,
        currentPayload: {
          actionTitle: approval.actionTitle,
          category: approval.category,
          payloadSummary: approval.payloadSummary,
          payloadData: approval.payloadData ?? {},
        },
        idempotencyKey: `verify-${approval.id}`,
        integrationConnected: false,
        targetPlatform: approval.targetPlatform,
      });
      setFeedback(res.message || 'بررسی یکپارچگی هش SHA-256 با موفقیت انجام شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بررسی یکپارچگی امضای دیجیتال');
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitRevisedApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingApproval || !editTitle.trim() || !editPayload.trim()) return;
    setBusyId(editingApproval.id);
    setError(null);
    setFeedback(null);
    try {
      if (editingApproval.status === 'pending') {
        await resolveApprovalRequest(
          business.id,
          ownerId,
          editingApproval,
          'changes_requested',
          'به‌روزرسانی و ثبت نسخه جدید برای تأیید'
        );
      }
      await createApprovalRequest(business.id, ownerId, {
        category: editingApproval.category,
        actionTitle: editTitle.trim(),
        requestingAgentId: editingApproval.requestingAgentId,
        requestingAgentName: editingApproval.requestingAgentName || 'مالک کسب‌وکار',
        targetPlatform: editingApproval.targetPlatform,
        reason: editingApproval.reason || 'نسخه اصلاح‌شده برای تأیید نهایی',
        payloadSummary: editPayload.trim(),
        payloadData: editingApproval.payloadData,
        relatedEntityType: editingApproval.relatedEntityType,
        relatedEntityId: editingApproval.relatedEntityId,
      });
      setEditingApproval(null);
      setTab('pending');
      setFeedback('نسخه اصلاح‌شده با امضای جدید (SHA-256) در صف تأیید ثبت شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت درخواست اصلاح‌شده');
    } finally {
      setBusyId(null);
    }
  };

  const statusLabel = (status: ApprovalStatus) => t.statuses[status] || status;

  return (
    <div className="space-y-6">
      {/* Human Control Policy Banner */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">
              سیاست کنترل انسانی و ممیزی اقدامات
            </h2>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              هیچ انتشار عمومی، تغییر قیمت، ارسال پیام به مشتری یا شروع کمپین بدون تأیید صریح شما انجام نمی‌شود.
              تمام درخواست‌ها با هش رمزنگاری‌شده (SHA-256) قفل می‌شوند تا متن تأییدشده پس از تصمیم قابل دستکاری نباشد.
            </p>
          </div>
        </div>
        <div className="text-xs text-[#94A3B8] tabular-nums whitespace-nowrap shrink-0">
          {formatNumber(counts.pending, locale, numeralStyle)} در انتظار تصمیم
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#273449] pb-3">
        {(
          [
            { id: 'pending', label: 'در انتظار تأیید', count: counts.pending },
            { id: 'changes_requested', label: 'نیازمند اصلاح', count: counts.changes },
            { id: 'resolved', label: 'تاریخچه تصمیم‌ها', count: counts.resolved },
            { id: 'all', label: 'همه', count: counts.all },
          ] as Array<{ id: FilterTab; label: string; count: number }>
        ).map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${
                active
                  ? 'bg-[#6366F1] text-white'
                  : 'bg-[#151E33] border border-[#273449] text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              <span>{item.label}</span>
              <span className="tabular-nums opacity-85">
                ({formatNumber(item.count, locale, numeralStyle)})
              </span>
            </button>
          );
        })}
      </div>

      {error && <ErrorState message={error} />}
      {feedback && (
        <div className="p-3 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E]">
          {feedback}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={tab === 'pending' ? 'هیچ درخواستی در صف انتظار نیست' : 'موردی در این بخش یافت نشد'}
          description="هنگامی که ایجنت‌ها پیش‌نویس انتشار، پاسخ به مشتری، کمپین یا تغییر قیمت را آماده کنند، درخواست تأیید اینجا نمایش داده می‌شود."
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((appr) => {
            const isActionable = appr.status === 'pending' || appr.status === 'changes_requested';
            const isBusy = busyId === appr.id;
            return (
              <div
                key={appr.id}
                className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                      <span className="text-[#8B5CF6] font-medium">
                        {CATEGORY_LABELS[appr.category] || appr.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>درخواست‌کننده: {appr.requestingAgentName || 'سیستم'}</span>
                      {appr.targetPlatform && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>مقصد: {appr.targetPlatform}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {formatJalaliDateTime(appr.createdAt, locale, numeralStyle)}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-[#F8FAFC]">{appr.actionTitle}</h3>
                  </div>

                  <StatusIndicator status={appr.status} label={statusLabel(appr.status)} />
                </div>

                {appr.reason && (
                  <div className="text-xs text-[#94A3B8]">
                    <span className="text-[#F8FAFC] font-medium">دلیل درخواست: </span>
                    {appr.reason}
                  </div>
                )}

                {appr.payloadSummary && (
                  <div className="bg-[#0B1020] border border-[#273449] rounded-lg p-3.5 text-xs text-[#F8FAFC] leading-relaxed whitespace-pre-wrap">
                    {appr.payloadSummary}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#94A3B8]">
                  <div className="flex items-center gap-1.5 font-mono" dir="ltr">
                    <Hash className="w-3.5 h-3.5 text-[#8B5CF6]" />
                    <span>SHA-256: {appr.payloadHash.slice(0, 16)}...</span>
                  </div>
                  {appr.relatedEntityType && (
                    <span>
                      موجودیت مرتبط: {appr.relatedEntityType} ({formatDigits(appr.relatedEntityId || '', numeralStyle)})
                    </span>
                  )}
                </div>

                {appr.resolutionNote && (
                  <div className="text-xs text-[#94A3B8] border-t border-[#273449] pt-3">
                    <span className="font-medium text-[#F8FAFC]">یادداشت تصمیم: </span>
                    {appr.resolutionNote}
                  </div>
                )}

                {appr.executionResult && (
                  <div className="text-xs text-[#22C55E] border-t border-[#273449] pt-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">نتیجه ثبت‌شده: </span>
                      {appr.executionResult}
                    </div>
                    {appr.status === 'approved' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleVerifyIntegrityGate(appr)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] text-[11px] text-[#94A3B8] hover:text-[#F8FAFC] rounded-lg"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-[#8B5CF6]" />
                        <span>بررسی امضای SHA-256 و وضعیت اتصال</span>
                      </button>
                    )}
                  </div>
                )}

                {isActionable && (
                  <div className="pt-3 border-t border-[#273449] space-y-3">
                    <input
                      value={notesById[appr.id] ?? ''}
                      onChange={(e) =>
                        setNotesById((prev) => ({ ...prev, [appr.id]: e.target.value }))
                      }
                      placeholder="یادداشت یا بازخورد برای ثبت در تاریخچه ممیزی (اختیاری)..."
                      className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-xs outline-none"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDecision(appr, 'approved')}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 text-[#0B1020] text-xs font-bold rounded-lg transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>تأیید نهایی</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDecision(appr, 'changes_requested')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#11182A] border border-[#F59E0B]/50 hover:border-[#F59E0B] disabled:opacity-50 text-[#F59E0B] text-xs font-medium rounded-lg transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>درخواست اصلاح</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDecision(appr, 'rejected')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#11182A] border border-[#EF4444]/40 hover:border-[#EF4444] disabled:opacity-50 text-[#EF4444] text-xs font-medium rounded-lg transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>رد اقدام</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingApproval(appr);
                          setEditTitle(appr.actionTitle);
                          setEditPayload(appr.payloadSummary || '');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] text-xs text-[#94A3B8] hover:text-[#F8FAFC] rounded-lg"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>ویرایش و ثبت درخواست جدید</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit & Re-request Modal */}
      {editingApproval && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitRevisedApproval}
            className="bg-[#151E33] border border-[#273449] rounded-xl max-w-xl w-full p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-[#F8FAFC]">
              <FileWarning className="w-5 h-5 text-[#F59E0B]" />
              <h3 className="text-base font-semibold">ویرایش متن و ثبت درخواست تأیید جدید</h3>
            </div>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              به دلیل قفل یکپارچگی هش، پس از ویرایش متن، یک درخواست تأیید جدید با امضای SHA-256 تازه ثبت می‌شود.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1">عنوان اقدام</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#94A3B8] mb-1">متن یا جزئیات نهایی</label>
                <textarea
                  rows={6}
                  value={editPayload}
                  onChange={(e) => setEditPayload(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-xs leading-relaxed outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingApproval(null)}
                className="px-3.5 py-2 text-xs text-[#94A3B8]"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={busyId === editingApproval.id}
                className="px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg"
              >
                ثبت درخواست جدید
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
