import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'خطای غیرمنتظره رخ داد.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#151E33] border border-[#273449] rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#EF4444]">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">خطای سیستمی یا دسترسی داده</h2>
            </div>
            <p className="text-sm text-[#94A3B8] leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-4 h-4" />
              <span>بارگذاری مجدد صفحه</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function MetricCard({
  label,
  value,
  source,
  period,
  unavailable,
}: {
  label: string;
  value: string;
  source: string;
  period: string;
  unavailable?: boolean;
}) {
  return (
    <div className="bg-[#151E33] border border-[#273449] rounded-xl p-4 flex flex-col justify-between gap-3">
      <div className="text-xs font-medium text-[#94A3B8]">{label}</div>
      <div
        className={`text-2xl font-bold tabular-nums tracking-tight ${
          unavailable ? 'text-[#94A3B8] text-base font-medium' : 'text-[#F8FAFC]'
        }`}
      >
        {value}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-[#94A3B8] border-t border-[#273449] pt-2.5">
        <span className="truncate">{source}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{period}</span>
      </div>
    </div>
  );
}

export function StatusIndicator({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  const s = status.toLowerCase();
  if (['active', 'approved', 'completed', 'published', 'paid', 'delivered', 'connected', 'success'].includes(s)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#22C55E] whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  if (['pending', 'in_review', 'working', 'in_progress', 'awaiting_approval', 'waiting_approval', 'scheduled', 'changes_requested', 'waiting_input', 'awaiting_input'].includes(s)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F59E0B] whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  if (['failed', 'rejected', 'error', 'expired', 'cancelled'].includes(s)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#EF4444] whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  if (['disabled', 'paused', 'inactive', 'not_connected', 'disconnected'].includes(s)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#94A3B8] whitespace-nowrap">
        <PauseCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#94A3B8] whitespace-nowrap">
      <Info className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-[#151E33] border border-[#273449] rounded-xl p-8 text-center space-y-3">
      <h3 className="text-base font-semibold text-[#F8FAFC]">{title}</h3>
      <p className="text-sm text-[#94A3B8] max-w-md mx-auto leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <div className="pt-2">
          <button
            onClick={onAction}
            className="px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function LoadingState({ text = 'در حال بارگذاری...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-12 text-sm text-[#94A3B8]">
      <Loader2 className="w-5 h-5 animate-spin text-[#6366F1]" />
      <span>{text}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-[#151E33] border border-[#EF4444]/40 rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 text-sm text-[#EF4444]">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 bg-[#11182A] border border-[#273449] hover:border-[#3B4D6B] text-xs font-medium text-[#F8FAFC] rounded-lg whitespace-nowrap shrink-0"
        >
          تلاش مجدد
        </button>
      )}
    </div>
  );
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = 'تأیید',
  cancelLabel = 'انصراف',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#151E33] border border-[#273449] rounded-xl max-w-md w-full p-6 space-y-4">
        <h3 className="text-base font-semibold text-[#F8FAFC]">{title}</h3>
        <p className="text-sm text-[#94A3B8] leading-relaxed">{description}</p>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-[#94A3B8] hover:text-[#F8FAFC] bg-[#11182A] border border-[#273449] rounded-lg transition-colors whitespace-nowrap"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors whitespace-nowrap ${
              destructive ? 'bg-[#EF4444] hover:bg-[#DC2626]' : 'bg-[#6366F1] hover:bg-[#5558E6]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
