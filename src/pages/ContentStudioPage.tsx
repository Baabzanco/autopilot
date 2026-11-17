import React, { useState } from 'react';
import { Check, Copy, Loader2, Plus, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { generateContentDraft, repurposeContentDraft } from '../services/apiClient';
import {
  createApprovalRequest,
  createContentItem,
  deleteContentItem,
  logActivity,
  updateContentItem,
} from '../services/dataAccess';
import { formatNumber } from '../lib/localization';
import type {
  Business,
  ContentItem,
  ContentStatus,
  ContentType,
  MediaAsset,
  SocialPlatform,
} from '../types/domain';
import { ConfirmationDialog, EmptyState, ErrorState, MetricCard, StatusIndicator } from '../components/ui/Primitives';

const PLATFORMS: SocialPlatform[] = ['instagram', 'telegram', 'youtube', 'linkedin', 'tiktok', 'x', 'newsletter'];
const FORMATS: ContentType[] = ['post', 'carousel', 'reel_script', 'short_script', 'video_description', 'story', 'thread', 'newsletter'];

export function ContentStudioPage({
  business,
  ownerId,
  content,
  mediaAssets,
}: {
  business: Business;
  ownerId: string;
  content: ContentItem[];
  mediaAssets: MediaAsset[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [selectedId, setSelectedId] = useState<string | null>(content[0]?.id || null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // AI Generator Modal / Panel state
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiMode, setAiMode] = useState<'idea' | 'topic' | 'url' | 'improve'>('topic');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPlatform, setAiPlatform] = useState<SocialPlatform>('instagram');
  const [aiType, setAiType] = useState<ContentType>('carousel');
  const [aiObjective, setAiObjective] = useState('آموزش و جذب مخاطب جدید');
  const [aiLang, setAiLang] = useState<'fa' | 'en' | 'ar'>('fa');
  const [generating, setGenerating] = useState(false);

  // Repurpose Modal state
  const [showRepurpose, setShowRepurpose] = useState(false);
  const [repurposeTargets, setRepurposeTargets] = useState<SocialPlatform[]>(['telegram', 'linkedin']);
  const [repurposing, setRepurposing] = useState(false);

  // Editor state
  const activeItem = content.find((c) => c.id === selectedId) || null;
  const [editTitle, setEditTitle] = useState('');
  const [editPlatform, setEditPlatform] = useState<SocialPlatform>('instagram');
  const [editType, setEditType] = useState<ContentType>('post');
  const [editCaption, setEditCaption] = useState('');
  const [editScript, setEditScript] = useState('');
  const [editCta, setEditCta] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editLanguage, setEditLanguage] = useState<'fa' | 'en' | 'ar'>('fa');
  const [editMediaIds, setEditMediaIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadIntoEditor = (item: ContentItem) => {
    setSelectedId(item.id);
    setEditTitle(item.title);
    setEditPlatform(item.platform);
    setEditType(item.contentType);
    setEditCaption(item.caption || '');
    setEditScript(item.script || '');
    setEditCta(item.cta || '');
    setEditHashtags((item.hashtags || []).join('، '));
    setEditLanguage(item.language || 'fa');
    setEditMediaIds(item.mediaIds || []);
    setFeedback(null);
    setError(null);
  };

  const handleCreateBlank = async () => {
    setError(null);
    const id = await createContentItem(business.id, ownerId, {
      title: 'پیش‌نویس جدید',
      platform: 'instagram',
      contentType: 'post',
      language: 'fa',
      caption: '',
      script: '',
      hashtags: [],
      status: 'draft',
      aiGenerated: false,
    });
    setSelectedId(id);
    setEditTitle('پیش‌نویس جدید');
    setEditPlatform('instagram');
    setEditType('post');
    setEditCaption('');
    setEditScript('');
    setEditCta('');
    setEditHashtags('');
    setEditLanguage('fa');
    setEditMediaIds([]);
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await generateContentDraft({
        mode: aiMode,
        promptInput: aiPrompt,
        platform: aiPlatform,
        contentType: aiType,
        objective: aiObjective,
        tone: business.brandSettings?.voice || 'صمیمی و حرفه‌ای',
        language: aiLang,
        business,
      });

      const slideText =
        res.slides.length > 0
          ? `${res.script ? res.script + '\n\n' : ''}اسلایدهای پیشنهادی:\n${res.slides.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
          : res.script;

      const id = await createContentItem(business.id, ownerId, {
        title: res.title,
        platform: aiPlatform,
        contentType: aiType,
        topic: aiPrompt.slice(0, 280),
        objective: aiObjective,
        language: aiLang,
        caption: res.caption,
        script: slideText,
        cta: res.cta,
        hashtags: res.hashtags,
        status: 'draft',
        aiGenerated: true,
        aiModel: 'gemini-4-hydrogen',
      });

      setSelectedId(id);
      setEditTitle(res.title);
      setEditPlatform(aiPlatform);
      setEditType(aiType);
      setEditCaption(res.caption);
      setEditScript(slideText);
      setEditCta(res.cta);
      setEditHashtags(res.hashtags.join('، '));
      setEditLanguage(aiLang);
      setEditMediaIds([]);
      setShowAiPanel(false);
      setAiPrompt('');
      setFeedback('پیش‌نویس جدید با هوش مصنوعی تولید و ذخیره شد (بدون انتشار خودکار).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تولید محتوا');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!activeItem) return;
    setSaving(true);
    setError(null);
    try {
      const parsedHashtags = editHashtags
        .split(/[،,\s#]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await updateContentItem(business.id, activeItem.id, {
        title: editTitle,
        platform: editPlatform,
        contentType: editType,
        caption: editCaption,
        script: editScript,
        cta: editCta,
        hashtags: parsedHashtags,
        language: editLanguage,
        mediaIds: editMediaIds,
      });
      setFeedback('تغییرات پیش‌نویس ذخیره شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره محتوا');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!activeItem) return;
    setSaving(true);
    setError(null);
    try {
      await handleSaveEdits();
      await updateContentItem(business.id, activeItem.id, { status: 'in_review' });
      await createApprovalRequest(business.id, ownerId, {
        category: 'content_publication',
        actionTitle: `تأیید انتشار: ${editTitle || activeItem.title}`,
        requestingAgentName: activeItem.aiGenerated ? 'ایجنت محتوا' : 'مالک کسب‌وکار',
        targetPlatform: t.platforms[editPlatform],
        reason: 'بررسی و تأیید نهایی متن و پلتفرم مقصد پیش از انتشار',
        payloadSummary: `پلتفرم: ${t.platforms[editPlatform]}\nعنوان: ${editTitle}\n\nکپشن:\n${editCaption}\n\nدعوت به اقدام: ${editCta}`,
        payloadData: {
          contentId: activeItem.id,
          platform: editPlatform,
          contentType: editType,
        },
        relatedEntityType: 'content',
        relatedEntityId: activeItem.id,
      });
      setFeedback('درخواست تأیید انتشار به «مرکز تأییدها» ارسال شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ارسال برای تأیید');
    } finally {
      setSaving(false);
    }
  };

  const handleRepurpose = async () => {
    if (!activeItem || repurposeTargets.length === 0) return;
    setRepurposing(true);
    setError(null);
    try {
      const res = await repurposeContentDraft({
        original: activeItem,
        targetPlatforms: repurposeTargets,
        business,
      });
      for (const ver of res.versions) {
        const plat = PLATFORMS.includes(ver.platform) ? ver.platform : 'instagram';
        const ctype = FORMATS.includes(ver.contentType) ? ver.contentType : 'post';
        await createContentItem(business.id, ownerId, {
          title: ver.title,
          platform: plat,
          contentType: ctype,
          language: activeItem.language || 'fa',
          caption: ver.caption,
          script: ver.script,
          cta: ver.cta,
          hashtags: ver.hashtags || [],
          originalContentId: activeItem.id,
          status: 'draft',
          aiGenerated: true,
          aiModel: 'gemini-4-hydrogen',
        });
      }
      await logActivity(business.id, ownerId, {
        actorType: 'agent',
        actorName: 'ایجنت محتوا',
        action: 'بازآفرینی محتوا',
        entityType: 'content',
        entityId: activeItem.id,
        details: `${res.versions.length} نسخه جدید برای پلتفرم‌های دیگر ساخته شد.`,
      });
      setShowRepurpose(false);
      setFeedback(`${formatNumber(res.versions.length, locale, numeralStyle)} نسخه بازآفرینی‌شده در استودیو ذخیره شد.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بازآفرینی محتوا');
    } finally {
      setRepurposing(false);
    }
  };

  const filteredContent = content.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
    if (searchQuery.trim() && !c.title.includes(searchQuery.trim()) && !(c.caption || '').includes(searchQuery.trim())) {
      return false;
    }
    return true;
  });

  const counts = {
    total: content.length,
    drafts: content.filter((c) => c.status === 'draft' || c.status === 'idea').length,
    approved: content.filter((c) => c.status === 'approved' || c.status === 'scheduled').length,
    published: content.filter((c) => c.status === 'published').length,
  };

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="کل محتواها" value={formatNumber(counts.total, locale, numeralStyle)} source="استودیو محتوا" period="کل دوره" />
        <MetricCard label="پیش‌نویس و ایده" value={formatNumber(counts.drafts, locale, numeralStyle)} source="در حال تدوین" period="اکنون" />
        <MetricCard label="تأییدشده / زمان‌بندی" value={formatNumber(counts.approved, locale, numeralStyle)} source="آماده انتشار" period="اکنون" />
        <MetricCard label="منتشرشده" value={formatNumber(counts.published, locale, numeralStyle)} source="تأیید نهایی مالک" period="کل دوره" />
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجو در عنوان یا کپشن..."
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none w-56"
          />
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          >
            <option value="all">همه پلتفرم‌ها</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{t.platforms[p]}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          >
            <option value="all">همه وضعیت‌ها</option>
            {(['idea', 'draft', 'in_review', 'approved', 'scheduled', 'published'] as ContentStatus[]).map((st) => (
              <option key={st} value={st}>{t.statuses[st]}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateBlank}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#151E33] border border-[#273449] hover:border-[#3B4D6B] text-xs font-medium rounded-lg whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>پیش‌نویس دستی</span>
          </button>
          <button
            onClick={() => setShowAiPanel((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            <span>تولید محتوا با هوش مصنوعی</span>
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {feedback && (
        <div className="p-3 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E] flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* AI Generator Panel */}
      {showAiPanel && (
        <form onSubmit={handleAiGenerate} className="bg-[#151E33] border border-[#6366F1]/50 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">تولید محتوای هوشمند مطابق لحن برند</h3>
            <button type="button" onClick={() => setShowAiPanel(false)} className="text-xs text-[#94A3B8]">بستن</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <select
              value={aiMode}
              onChange={(e) => setAiMode(e.target.value as typeof aiMode)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              <option value="topic">تولید از موضوع</option>
              <option value="idea">توسعه ایده خام</option>
              <option value="url">تبدیل لینک یا متن مرجع</option>
              <option value="improve">بهبود متن موجود</option>
            </select>
            <select
              value={aiPlatform}
              onChange={(e) => setAiPlatform(e.target.value as SocialPlatform)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{t.platforms[p]}</option>
              ))}
            </select>
            <select
              value={aiType}
              onChange={(e) => setAiType(e.target.value as ContentType)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>{t.contentTypes[f]}</option>
              ))}
            </select>
            <select
              value={aiLang}
              onChange={(e) => setAiLang(e.target.value as 'fa' | 'en' | 'ar')}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              <option value="fa">زبان خروجی: فارسی (پیش‌فرض)</option>
              <option value="en">زبان خروجی: انگلیسی</option>
              <option value="ar">زبان خروجی: عربی</option>
            </select>
          </div>
          <input
            value={aiObjective}
            onChange={(e) => setAiObjective(e.target.value)}
            placeholder="هدف محتوا (مثلاً: معرفی محصول، افزایش ذخیره پست)"
            className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          />
          <textarea
            rows={3}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="موضوع، ایده، یا متن/لینک منبع را بنویسید..."
            className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-sm outline-none"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={generating || !aiPrompt.trim()}
              className="inline-flex items-center gap-2 px-5 py-2 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>تولید پیش‌نویس</span>
            </button>
          </div>
        </form>
      )}

      {/* Split View: Content List + Editor */}
      {content.length === 0 ? (
        <EmptyState
          title="استودیو محتوای شما خالی است"
          description="با کلیک بر «تولید محتوا با هوش مصنوعی» یا «پیش‌نویس دستی» اولین محتوای خود را ایجاد کنید."
          actionLabel="تولید اولین محتوا"
          onAction={() => setShowAiPanel(true)}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Content List */}
          <div className="lg:col-span-5 bg-[#151E33] border border-[#273449] rounded-xl divide-y divide-[#273449] max-h-[680px] overflow-y-auto">
            {filteredContent.map((item) => {
              const selected = activeItem?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => loadIntoEditor(item)}
                  className={`p-4 cursor-pointer transition-colors space-y-1.5 ${
                    selected ? 'bg-[#6366F1]/10' : 'hover:bg-[#11182A]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-[#F8FAFC] truncate">{item.title}</div>
                    <StatusIndicator status={item.status} label={t.statuses[item.status] || item.status} />
                  </div>
                  <div className="text-xs text-[#94A3B8]">
                    {t.platforms[item.platform]} · {t.contentTypes[item.contentType]}
                    {item.aiGenerated ? ' · تولید AI' : ''}
                    {item.originalContentId ? ' · بازآفرینی‌شده' : ''}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Content Editor */}
          <div className="lg:col-span-7 bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
            {!activeItem ? (
              <div className="py-16 text-center text-xs text-[#94A3B8]">
                یک مورد را از فهرست سمت راست برای ویرایش انتخاب کنید.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#273449] pb-4">
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={activeItem.status} label={t.statuses[activeItem.status]} />
                    {activeItem.aiGenerated && (
                      <span className="text-xs text-[#8B5CF6]">· {t.common.aiGenerated}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowRepurpose((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] text-xs rounded-lg"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>بازآفرینی برای سایر پلتفرم‌ها</span>
                    </button>
                    <button
                      onClick={() => setDeleteTarget(activeItem)}
                      className="p-2 text-[#94A3B8] hover:text-[#EF4444]"
                      title="حذف محتوا"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {showRepurpose && (
                  <div className="bg-[#11182A] border border-[#273449] rounded-lg p-4 space-y-3">
                    <div className="text-xs font-semibold text-[#F8FAFC]">پلتفرم‌های مقصد را برای ساخت نسخه جدید انتخاب کنید (اصل محتوا بدون تغییر می‌ماند):</div>
                    <div className="flex flex-wrap gap-2">
                      {PLATFORMS.filter((p) => p !== activeItem.platform).map((p) => {
                        const checked = repurposeTargets.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() =>
                              setRepurposeTargets((prev) =>
                                checked ? prev.filter((x) => x !== p) : [...prev, p]
                              )
                            }
                            className={`px-3 py-1 rounded-lg border text-xs ${
                              checked ? 'bg-[#6366F1] border-[#6366F1] text-white' : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                            }`}
                          >
                            {t.platforms[p]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowRepurpose(false)} className="text-xs text-[#94A3B8] px-3 py-1.5">انصراف</button>
                      <button
                        onClick={handleRepurpose}
                        disabled={repurposing || repurposeTargets.length === 0}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#6366F1] text-white text-xs font-medium rounded-lg"
                      >
                        {repurposing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>ساخت نسخه‌های جدید</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block text-xs text-[#94A3B8] mb-1">عنوان</label>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">پلتفرم</label>
                    <select
                      value={editPlatform}
                      onChange={(e) => setEditPlatform(e.target.value as SocialPlatform)}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    >
                      {PLATFORMS.map((p) => (
                        <option key={p} value={p}>{t.platforms[p]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">فرمت</label>
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as ContentType)}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    >
                      {FORMATS.map((f) => (
                        <option key={f} value={f}>{t.contentTypes[f]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">زبان</label>
                    <select
                      value={editLanguage}
                      onChange={(e) => setEditLanguage(e.target.value as 'fa' | 'en' | 'ar')}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    >
                      <option value="fa">فارسی</option>
                      <option value="en">انگلیسی</option>
                      <option value="ar">عربی</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-[#94A3B8]">کپشن / متن اصلی</label>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(editCaption)}
                      className="inline-flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-[#F8FAFC]"
                    >
                      <Copy className="w-3 h-3" />
                      <span>کپی کپشن</span>
                    </button>
                  </div>
                  <textarea
                    rows={5}
                    dir={editLanguage === 'en' ? 'ltr' : 'rtl'}
                    value={editCaption}
                    onChange={(e) => setEditCaption(e.target.value)}
                    className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm leading-relaxed outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#94A3B8] mb-1">سناریو / اسلایدها</label>
                  <textarea
                    rows={4}
                    dir={editLanguage === 'en' ? 'ltr' : 'rtl'}
                    value={editScript}
                    onChange={(e) => setEditScript(e.target.value)}
                    className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm leading-relaxed outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">فراخوان به اقدام (CTA)</label>
                    <input
                      value={editCta}
                      onChange={(e) => setEditCta(e.target.value)}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">هشتگ‌ها (با ویرگول یا فاصله جدا کنید)</label>
                    <input
                      value={editHashtags}
                      onChange={(e) => setEditHashtags(e.target.value)}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    />
                  </div>
                </div>

                {mediaAssets.length > 0 && (
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1.5">پیوست از کتابخانه رسانه</label>
                    <div className="flex flex-wrap gap-2">
                      {mediaAssets.slice(0, 8).map((m) => {
                        const attached = editMediaIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() =>
                              setEditMediaIds((prev) =>
                                attached ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                              )
                            }
                            className={`px-2.5 py-1 rounded border text-[11px] ${
                              attached ? 'bg-[#6366F1]/20 border-[#6366F1] text-[#F8FAFC]' : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                            }`}
                          >
                            {m.fileName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-[#273449]">
                  <button
                    type="button"
                    onClick={handleSaveEdits}
                    disabled={saving}
                    className="px-4 py-2 bg-[#11182A] border border-[#273449] hover:border-[#3B4D6B] text-xs font-medium rounded-lg"
                  >
                    ذخیره پیش‌نویس
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitForApproval}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>ارسال به مرکز تأییدها</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="حذف محتوا"
        description={t.common.confirmDelete}
        confirmLabel="حذف دائمی"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteContentItem(business.id, deleteTarget.id);
            if (selectedId === deleteTarget.id) setSelectedId(null);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
