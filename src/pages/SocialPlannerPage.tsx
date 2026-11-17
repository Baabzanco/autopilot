import React, { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Plus } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  formatDigits,
  formatJalaliDate,
  getJalaliMonthGrid,
  gregorianToJalali,
  isoGregorianToJalali,
  JALALI_MONTHS_FA,
  jalaliToIsoGregorian,
  PERSIAN_WEEKDAYS_FULL,
  PERSIAN_WEEKDAYS_SHORT,
} from '../lib/localization';
import { createContentItem, logActivity, updateContentItem } from '../services/dataAccess';
import type { Business, ContentItem, ContentStatus, Integration, SocialPlatform } from '../types/domain';
import { StatusIndicator } from '../components/ui/Primitives';

const PLATFORM_URLS: Record<SocialPlatform, string> = {
  instagram: 'https://www.instagram.com/',
  telegram: 'https://web.telegram.org/',
  youtube: 'https://studio.youtube.com/',
  tiktok: 'https://www.tiktok.com/upload',
  linkedin: 'https://www.linkedin.com/feed/',
  x: 'https://x.com/compose/post',
  newsletter: 'https://mail.google.com/',
};

export function SocialPlannerPage({
  business,
  ownerId,
  content,
  integrations,
}: {
  business: Business;
  ownerId: string;
  content: ContentItem[];
  integrations: Integration[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const now = new Date();
  const todayJalali = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const todayIso = jalaliToIsoGregorian(todayJalali.jy, todayJalali.jm, todayJalali.jd);

  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day' | 'list'>('month');
  const [jy, setJy] = useState(todayJalali.jy);
  const [jm, setJm] = useState(todayJalali.jm);
  const [selectedIso, setSelectedIso] = useState<string>(todayIso);
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [quickTitle, setQuickTitle] = useState('');
  const [quickPlatform, setQuickPlatform] = useState<SocialPlatform>('instagram');
  const [assignContentId, setAssignContentId] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const monthCells = useMemo(() => getJalaliMonthGrid(jy, jm), [jy, jm]);

  const filteredContent = useMemo(
    () =>
      content.filter((c) => {
        if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        return true;
      }),
    [content, platformFilter, statusFilter]
  );

  const unscheduledDrafts = filteredContent.filter((c) => !c.scheduledDate && c.status !== 'published');

  const itemsByDate = useMemo(() => {
    const map: Record<string, ContentItem[]> = {};
    for (const c of filteredContent) {
      if (c.scheduledDate) {
        map[c.scheduledDate] = map[c.scheduledDate] || [];
        map[c.scheduledDate].push(c);
      }
    }
    return map;
  }, [filteredContent]);

  const prevMonth = () => {
    if (jm === 1) {
      setJy((y) => y - 1);
      setJm(12);
    } else {
      setJm((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (jm === 12) {
      setJy((y) => y + 1);
      setJm(1);
    } else {
      setJm((m) => m + 1);
    }
  };

  const handleQuickCreateOnDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    await createContentItem(business.id, ownerId, {
      title: quickTitle.trim(),
      platform: quickPlatform,
      contentType: 'post',
      language: 'fa',
      status: 'scheduled',
      scheduledDate: selectedIso,
      scheduledTime: '18:00',
      aiGenerated: false,
    });
    setQuickTitle('');
  };

  const handleAssignDraftToDate = async () => {
    if (!assignContentId) return;
    await updateContentItem(business.id, assignContentId, {
      scheduledDate: selectedIso,
      status: 'scheduled',
    });
    setAssignContentId('');
  };

  const handleManualMarkPublished = async (item: ContentItem) => {
    await updateContentItem(business.id, item.id, {
      status: 'published',
      publishedAtLabel: formatJalaliDate(new Date(), locale, numeralStyle),
    });
    await logActivity(business.id, ownerId, {
      actorType: 'owner',
      actorName: 'مالک کسب‌وکار',
      action: 'ثبت انتشار دستی',
      entityType: 'content',
      entityId: item.id,
      details: `محتوای «${item.title}» پس از انتشار دستی در ${t.platforms[item.platform]} توسط مالک ثبت شد.`,
    });
  };

  const selectedDayItems = itemsByDate[selectedIso] || [];

  const activeWeekRow = useMemo(() => {
    const idx = monthCells.findIndex((c) => c.iso === selectedIso);
    const start = idx >= 0 ? Math.floor(idx / 7) * 7 : 0;
    return monthCells.slice(start, start + 7);
  }, [monthCells, selectedIso]);

  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-2 rounded-lg bg-[#11182A] border border-[#273449] hover:border-[#6366F1]" aria-label="ماه قبل">
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="text-base font-bold text-[#F8FAFC] min-w-[140px] text-center tabular-nums">
            {JALALI_MONTHS_FA[jm - 1]} {formatDigits(jy, numeralStyle)}
          </div>
          <button onClick={nextMonth} className="p-2 rounded-lg bg-[#11182A] border border-[#273449] hover:border-[#6366F1]" aria-label="ماه بعد">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-1.5 text-xs outline-none"
          >
            <option value="all">همه پلتفرم‌ها</option>
            {(['instagram', 'telegram', 'youtube', 'linkedin', 'tiktok', 'x'] as SocialPlatform[]).map((p) => (
              <option key={p} value={p}>{t.platforms[p]}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-1.5 text-xs outline-none"
          >
            <option value="all">همه وضعیت‌ها</option>
            {(['draft', 'in_review', 'approved', 'scheduled', 'published'] as ContentStatus[]).map((st) => (
              <option key={st} value={st}>{t.statuses[st]}</option>
            ))}
          </select>

          <div className="flex items-center gap-1 p-1 bg-[#0B1020] border border-[#273449] rounded-lg">
            {(
              [
                { id: 'month', label: 'ماهانه' },
                { id: 'week', label: 'هفتگی' },
                { id: 'day', label: 'روزانه' },
                { id: 'list', label: 'لیست' },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                onClick={() => setViewMode(v.id)}
                className={`px-3 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
                  viewMode === v.id ? 'bg-[#6366F1] text-white font-medium' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Calendar Main Area */}
        <div className="lg:col-span-8 bg-[#151E33] border border-[#273449] rounded-xl p-4">
          {viewMode === 'month' && (
            <div>
              <div className="grid grid-cols-7 gap-2 pb-2 border-b border-[#273449] text-center text-xs font-medium text-[#94A3B8]">
                {PERSIAN_WEEKDAYS_SHORT.map((d, idx) => (
                  <div key={idx}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2 pt-2">
                {monthCells.map((cell) => {
                  const dayItems = itemsByDate[cell.iso] || [];
                  const isToday = cell.iso === todayIso;
                  const isSelected = cell.iso === selectedIso;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelectedIso(cell.iso)}
                      className={`min-h-[84px] p-2 rounded-lg border text-right flex flex-col justify-between transition-colors ${
                        isSelected
                          ? 'bg-[#6366F1]/15 border-[#6366F1]'
                          : cell.isCurrentMonth
                          ? 'bg-[#11182A] border-[#273449] hover:border-[#3B4D6B]'
                          : 'bg-[#0B1020]/50 border-[#273449]/40 opacity-50'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={`text-xs font-semibold tabular-nums ${
                            isToday ? 'text-[#8B5CF6]' : 'text-[#F8FAFC]'
                          }`}
                        >
                          {formatDigits(cell.jd, numeralStyle)}
                        </span>
                        {dayItems.length > 0 && (
                          <span className="text-[10px] font-mono tabular-nums text-[#94A3B8]">
                            {formatDigits(dayItems.length, numeralStyle)}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 w-full">
                        {dayItems.slice(0, 2).map((it) => (
                          <div
                            key={it.id}
                            className="text-[10px] truncate px-1.5 py-0.5 rounded bg-[#151E33] border border-[#273449] text-[#F8FAFC]"
                          >
                            {it.title}
                          </div>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === 'week' && (
            <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
              {activeWeekRow.map((cell, idx) => {
                const dayItems = itemsByDate[cell.iso] || [];
                const isSelected = cell.iso === selectedIso;
                return (
                  <div
                    key={cell.iso}
                    onClick={() => setSelectedIso(cell.iso)}
                    className={`p-3 rounded-lg border min-h-[180px] cursor-pointer space-y-2 ${
                      isSelected ? 'bg-[#6366F1]/15 border-[#6366F1]' : 'bg-[#11182A] border-[#273449]'
                    }`}
                  >
                    <div className="text-xs font-semibold text-[#F8FAFC] border-b border-[#273449] pb-1.5">
                      {PERSIAN_WEEKDAYS_FULL[idx]} · {formatDigits(cell.jd, numeralStyle)} {JALALI_MONTHS_FA[cell.jm - 1]}
                    </div>
                    {dayItems.length === 0 ? (
                      <div className="text-[11px] text-[#94A3B8]">خالی</div>
                    ) : (
                      dayItems.map((it) => (
                        <div key={it.id} className="p-2 rounded bg-[#151E33] border border-[#273449] text-xs space-y-1">
                          <div className="font-medium text-[#F8FAFC] truncate">{it.title}</div>
                          <div className="text-[10px] text-[#94A3B8]">{t.platforms[it.platform]}</div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(viewMode === 'day' || viewMode === 'list') && (
            <div className="divide-y divide-[#273449]">
              {(viewMode === 'day' ? selectedDayItems : filteredContent).length === 0 ? (
                <div className="py-12 text-center text-xs text-[#94A3B8]">
                  محتوایی برای نمایش در این بازه ثبت نشده است.
                </div>
              ) : (
                (viewMode === 'day' ? selectedDayItems : filteredContent).map((item) => {
                  const j = item.scheduledDate ? isoGregorianToJalali(item.scheduledDate) : null;
                  return (
                    <div key={item.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-[#F8FAFC]">{item.title}</div>
                        <div className="text-xs text-[#94A3B8]">
                          {t.platforms[item.platform]} · {t.contentTypes[item.contentType]}
                          {j ? ` · ${formatDigits(`${j.jd} ${JALALI_MONTHS_FA[j.jm - 1]} ${j.jy}`, numeralStyle)}` : ' · بدون تاریخ'}
                        </div>
                      </div>
                      <StatusIndicator status={item.status} label={t.statuses[item.status]} />
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Selected Jalali Day Drawer & Manual Publishing Workflow */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-[#151E33] border border-[#273449] rounded-xl p-4 space-y-4">
            <div className="border-b border-[#273449] pb-3">
              <div className="text-xs text-[#94A3B8]">برنامه‌ریزی برای تاریخ</div>
              <div className="text-sm font-bold text-[#F8FAFC] mt-0.5 tabular-nums">
                {(() => {
                  const j = isoGregorianToJalali(selectedIso);
                  return j
                    ? formatDigits(`${j.jd} ${JALALI_MONTHS_FA[j.jm - 1]} ${j.jy}`, numeralStyle)
                    : selectedIso;
                })()}
              </div>
            </div>

            {/* Quick Create on Selected Day */}
            <form onSubmit={handleQuickCreateOnDate} className="space-y-2.5">
              <input
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="افزودن سریع برنامه محتوا..."
                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              />
              <div className="flex items-center gap-2">
                <select
                  value={quickPlatform}
                  onChange={(e) => setQuickPlatform(e.target.value as SocialPlatform)}
                  className="flex-1 bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-2 text-xs outline-none"
                >
                  {(['instagram', 'telegram', 'youtube', 'linkedin', 'tiktok', 'x'] as SocialPlatform[]).map((p) => (
                    <option key={p} value={p}>{t.platforms[p]}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3 py-2 bg-[#6366F1] text-white text-xs font-medium rounded-lg whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ثبت در تاریخ</span>
                </button>
              </div>
            </form>

            {/* Assign existing unscheduled draft */}
            {unscheduledDrafts.length > 0 && (
              <div className="pt-3 border-t border-[#273449] space-y-2">
                <div className="text-xs text-[#94A3B8]">انتقال پیش‌نویس موجود به این روز:</div>
                <div className="flex items-center gap-2">
                  <select
                    value={assignContentId}
                    onChange={(e) => setAssignContentId(e.target.value)}
                    className="flex-1 bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-2 text-xs outline-none"
                  >
                    <option value="">انتخاب پیش‌نویس...</option>
                    {unscheduledDrafts.map((d) => (
                      <option key={d.id} value={d.id}>{d.title}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAssignDraftToDate}
                    disabled={!assignContentId}
                    className="px-3 py-2 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] text-xs rounded-lg disabled:opacity-50"
                  >
                    زمان‌بندی
                  </button>
                </div>
              </div>
            )}

            {/* Day Items & Manual Publishing Workflow */}
            <div className="pt-3 border-t border-[#273449] space-y-3">
              {selectedDayItems.length === 0 ? (
                <div className="text-xs text-[#94A3B8]">برای این تاریخ محتوایی ثبت نشده است.</div>
              ) : (
                selectedDayItems.map((item) => {
                  const platformInt = integrations.find((i) => i.provider === item.platform);
                  const isConnected = platformInt?.connectionStatus === 'connected';
                  return (
                    <div key={item.id} className="bg-[#11182A] border border-[#273449] rounded-lg p-3 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-[#F8FAFC]">{item.title}</div>
                          <div className="text-[11px] text-[#94A3B8]">
                            {t.platforms[item.platform]} · {isConnected ? 'API متصل' : 'انتشار دستی'}
                          </div>
                        </div>
                        <StatusIndicator status={item.status} label={t.statuses[item.status]} />
                      </div>

                      {/* Manual Publishing Controls when API is not connected */}
                      {item.status !== 'published' && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(item.caption || item.title);
                              setCopiedId(item.id);
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#151E33] border border-[#273449] text-[11px] rounded hover:border-[#6366F1]"
                          >
                            {copiedId === item.id ? <Check className="w-3 h-3 text-[#22C55E]" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedId === item.id ? 'کپی شد' : 'کپی کپشن'}</span>
                          </button>
                          <a
                            href={PLATFORM_URLS[item.platform]}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#151E33] border border-[#273449] text-[11px] rounded hover:border-[#6366F1]"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>باز کردن {t.platforms[item.platform]}</span>
                          </a>
                          {(item.status === 'approved' || item.status === 'scheduled') && (
                            <button
                              type="button"
                              onClick={() => handleManualMarkPublished(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#22C55E]/15 border border-[#22C55E]/40 text-[#22C55E] text-[11px] font-medium rounded"
                            >
                              <Check className="w-3 h-3" />
                              <span>ثبت «منتشر شد»</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
