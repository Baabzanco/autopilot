import React, { useMemo, useState } from 'react';
import { BarChart2, Brain, Check, Edit3, Plus, Search, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { createMemoryItem, deleteMemoryItem, logActivity, updateMemoryItem } from '../services/dataAccess';
import { formatJalaliDateTime, formatNumber } from '../lib/localization';
import type { Business, BusinessMemoryItem, MemoryCategory } from '../types/domain';
import { ConfirmationDialog, EmptyState, ErrorState } from '../components/ui/Primitives';

const MEMORY_CATEGORIES: Record<MemoryCategory, string> = {
  business_profile: 'پروفایل کسب‌وکار',
  brand_identity: 'هویت و لحن برند',
  audience_profile: 'شناخت مخاطبان',
  products: 'محصولات و خدمات',
  content_history: 'تجربه‌های محتوایی',
  customer_insights: 'بینش مشتریان',
  business_goals: 'اهداف کسب‌وکار',
  decisions: 'تصمیم‌های کلیدی',
  campaign_history: 'سوابق کمپین‌ها',
  performance_insights: 'تحلیل عملکرد',
};

export function BusinessMemoryPage({
  business,
  ownerId,
  memoryItems,
}: {
  business: Business;
  ownerId: string;
  memoryItems: BusinessMemoryItem[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [categoryFilter, setCategoryFilter] = useState<'all' | MemoryCategory>('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<BusinessMemoryItem | null>(null);
  const [category, setCategory] = useState<MemoryCategory>('brand_identity');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BusinessMemoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return memoryItems.filter((m) => {
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      if (!q) return true;
      return m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q);
    });
  }, [memoryItems, categoryFilter, search]);

  const verifiedCount = memoryItems.filter((m) => m.verifiedByOwner).length;

  const openCreateForm = () => {
    setEditingItem(null);
    setCategory('brand_identity');
    setTitle('');
    setContent('');
    setShowForm(true);
  };

  const openEditForm = (item: BusinessMemoryItem) => {
    setEditingItem(item);
    setCategory(item.category);
    setTitle(item.title);
    setContent(item.content);
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setError(null);
    try {
      if (editingItem) {
        await updateMemoryItem(business.id, editingItem.id, {
          category,
          title: title.trim(),
          content: content.trim(),
          sourceType: 'owner_confirmed',
          verifiedByOwner: true,
          confidence: 1,
        });
      } else {
        await createMemoryItem(business.id, ownerId, {
          category,
          title: title.trim(),
          content: content.trim(),
          sourceType: 'owner_confirmed',
          verifiedByOwner: true,
          confidence: 1,
        });
        await logActivity(business.id, ownerId, {
          actorType: 'owner',
          actorName: 'مالک کسب‌وکار',
          action: 'افزودن مورد جدید به حافظه کسب‌وکار',
          entityType: 'businessMemory',
          details: `حافظه «${title.trim()}» در دسته ${MEMORY_CATEGORIES[category]} ثبت شد.`,
        });
      }
      setShowForm(false);
      setEditingItem(null);
      setTitle('');
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره حافظه کسب‌وکار');
    }
  };

  const handleConfirmAiMemory = async (item: BusinessMemoryItem) => {
    setError(null);
    try {
      await updateMemoryItem(business.id, item.id, {
        sourceType: 'owner_confirmed',
        verifiedByOwner: true,
        confidence: 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تأیید مورد حافظه');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Summary */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Brain className="w-5 h-5 text-[#8B5CF6] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">حافظه مشترک کسب‌وکار و برند</h2>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              تمام ایجنت‌های هوش مصنوعی پیش از تولید محتوا یا پیشنهاد استراتژی به این اطلاعات استناد می‌کنند.
              موارد «تأییدشده توسط مالک» اولویت قطعی بر «پیشنهادهای استنباطی هوش مصنوعی» دارند.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs text-[#94A3B8] tabular-nums">
            {formatNumber(verifiedCount, locale, numeralStyle)} از {formatNumber(memoryItems.length, locale, numeralStyle)} مورد تأییدشده
          </div>
          <button
            onClick={openCreateForm}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>افزودن به حافظه</span>
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {showForm && (
        <form onSubmit={handleSave} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[#F8FAFC]">
            {editingItem ? 'ویرایش مورد حافظه' : 'ثبت دانش یا قانون جدید برند'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as MemoryCategory)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              {Object.entries(MEMORY_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان خلاصه (مثلاً: قانون قیمت‌گذاری یا خط قرمز برند) *"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none md:col-span-2"
            />
            <textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="متن دقیق دانش یا دستورالعمل برای ایجنت‌ها *"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none md:col-span-3 leading-relaxed"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingItem(null);
              }}
              className="px-3 py-1.5 text-xs text-[#94A3B8]"
            >
              انصراف
            </button>
            <button type="submit" className="px-4 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg">
              ذخیره و تأیید مالک
            </button>
          </div>
        </form>
      )}

      {/* Search & Category Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#94A3B8] absolute right-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو در عنوان یا متن حافظه..."
            className="w-full bg-[#151E33] border border-[#273449] focus:border-[#6366F1] rounded-lg pr-9 pl-3 py-2 text-xs outline-none"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as 'all' | MemoryCategory)}
          className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
        >
          <option value="all">همه دسته‌بندی‌ها</option>
          {Object.entries(MEMORY_CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="حافظه کسب‌وکار خالی است"
          description="اطلاعات کلیدی برند، سلایق مخاطبان، تصمیم‌های استراتژیک یا قوانین نگارشی خود را ثبت کنید تا تمام ایجنت‌ها هماهنگ عمل کنند."
          actionLabel="ثبت اولین مورد"
          onAction={openCreateForm}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item) => {
            const isVerified = item.verifiedByOwner || item.sourceType === 'owner_confirmed';
            return (
              <div
                key={item.id}
                className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#94A3B8]">
                        <span className="text-[#8B5CF6] font-medium">{MEMORY_CATEGORIES[item.category]}</span>
                        <span aria-hidden="true">·</span>
                        {isVerified ? (
                          <span className="inline-flex items-center gap-1 text-[#22C55E] font-medium">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>{t.common.confirmedFact}</span>
                          </span>
                        ) : item.sourceType === 'analytics_derived' ? (
                          <span className="inline-flex items-center gap-1 text-[#94A3B8]">
                            <BarChart2 className="w-3.5 h-3.5" />
                            <span>تحلیل‌شده از داده‌ها</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#F59E0B]">
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>{t.common.aiAssumption}</span>
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold text-[#F8FAFC]">{item.title}</h3>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditForm(item)}
                        className="text-[#94A3B8] hover:text-[#F8FAFC]"
                        aria-label="ویرایش"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item)}
                        className="text-[#94A3B8] hover:text-[#EF4444]"
                        aria-label="حذف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-[#94A3B8] leading-relaxed whitespace-pre-wrap">{item.content}</p>
                </div>

                <div className="pt-3 border-t border-[#273449] flex items-center justify-between gap-2 text-[11px] text-[#94A3B8]">
                  <span className="tabular-nums">
                    {formatJalaliDateTime(item.updatedAt || item.createdAt, locale, numeralStyle)}
                  </span>
                  {!isVerified && (
                    <button
                      type="button"
                      onClick={() => handleConfirmAiMemory(item)}
                      className="inline-flex items-center gap-1 text-[#22C55E] hover:underline font-medium"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>تأیید توسط مالک</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="حذف از حافظه کسب‌وکار"
        description={t.common.confirmDelete}
        confirmLabel="حذف"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteMemoryItem(business.id, deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
