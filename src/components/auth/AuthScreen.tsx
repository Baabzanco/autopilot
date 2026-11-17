import React, { useState } from 'react';
import { ShieldCheck, Cpu, Calendar, Loader2, AlertCircle } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { signInWithGooglePopup } from '../../lib/firebase';

export function AuthScreen() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGooglePopup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.auth.authError;
      setError(msg.includes('popup-closed') ? 'پنجره ورود بسته شد. لطفاً دوباره امتحان کنید.' : `${t.auth.authError} (${msg})`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Main Value & Product Narrative Column */}
      <div className="flex-1 flex flex-col justify-between p-8 lg:p-16 border-b lg:border-b-0 lg:border-l border-[#273449]">
        <div className="space-y-2">
          <div className="text-lg font-bold tracking-tight text-[#F8FAFC]">{t.brand.name}</div>
          <div className="text-xs text-[#94A3B8]">{t.brand.edition} · {t.brand.tagline}</div>
        </div>

        <div className="max-w-xl space-y-8 my-12">
          <h1 className="text-3xl lg:text-4xl font-bold leading-snug text-[#F8FAFC] [text-wrap:balance]">
            {t.auth.welcomeTitle}
          </h1>
          <p className="text-base text-[#94A3B8] leading-relaxed">
            {t.auth.welcomeSubtitle}
          </p>

          <div className="space-y-4 pt-2 border-t border-[#273449]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
              <span className="text-sm text-[#F8FAFC] leading-relaxed">{t.auth.humanControlPoint1}</span>
            </div>
            <div className="flex items-start gap-3">
              <Cpu className="w-5 h-5 text-[#6366F1] shrink-0 mt-0.5" />
              <span className="text-sm text-[#F8FAFC] leading-relaxed">{t.auth.humanControlPoint2}</span>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-[#8B5CF6] shrink-0 mt-0.5" />
              <span className="text-sm text-[#F8FAFC] leading-relaxed">{t.auth.humanControlPoint3}</span>
            </div>
          </div>
        </div>

        <div className="text-xs text-[#94A3B8]">
          {t.auth.privacyNote}
        </div>
      </div>

      {/* Sign In Card Column */}
      <div className="w-full lg:w-[460px] bg-[#11182A] flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-sm bg-[#151E33] border border-[#273449] rounded-xl p-6 space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold text-[#F8FAFC]">ورود به میز کار</h2>
            <p className="text-sm text-[#94A3B8]">
              برای ورود یا ساخت حساب جدید، با حساب گوگل خود متصل شوید.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-start gap-2 text-xs text-[#EF4444]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
                />
              </svg>
            )}
            <span>{t.auth.googleButton}</span>
          </button>

          <div className="pt-4 border-t border-[#273449] space-y-2 text-xs text-[#94A3B8]">
            <div>زبان پیش‌فرض حساب: فارسی (راست‌به‌چپ)</div>
            <div>پشتیبانی از تقویم شمسی و واحد پول تومان/ریال</div>
          </div>
        </div>
      </div>
    </div>
  );
}
