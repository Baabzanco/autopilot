import React, { useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { createMediaAsset, deleteMediaAsset, updateMediaAsset } from '../services/dataAccess';
import { formatJalaliDate, formatNumber } from '../lib/localization';
import type { Business, MediaAsset, MediaCategory } from '../types/domain';
import { ConfirmationDialog, EmptyState, ErrorState } from '../components/ui/Primitives';

async function createCompactPreviewDataUrl(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 720;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(undefined);
        ctx.drawImage(img, 0, 0, width, height);
        const url = canvas.toDataURL('image/jpeg', 0.78);
        resolve(url.length < 320000 ? url : undefined);
      };
      img.onerror = () => resolve(undefined);
      img.src = String(reader.result);
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

export function MediaLibraryPage({
  business,
  ownerId,
  mediaAssets,
}: {
  business: Business;
  ownerId: string;
  mediaAssets: MediaAsset[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [uploadCategory, setUploadCategory] = useState<MediaCategory>('image');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('حجم فایل انتخاب‌شده بیش از حد مجاز (۱۰ مگابایت) است.');
      e.target.value = '';
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const previewUrl = await createCompactPreviewDataUrl(file);
      await createMediaAsset(business.id, ownerId, {
        fileName: file.name,
        category: uploadCategory,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        previewUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت فایل رسانه');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const filtered = mediaAssets.filter((m) => {
    if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
    if (search.trim() && !m.fileName.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی نام فایل..."
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none w-52"
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          >
            <option value="all">همه دسته‌ها</option>
            <option value="image">تصویر</option>
            <option value="logo">لوگو</option>
            <option value="brand_asset">هویت برند</option>
            <option value="thumbnail">تامبنیل</option>
            <option value="video">ویدیو</option>
            <option value="audio">صوت</option>
            <option value="document">سند</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={uploadCategory}
            onChange={(e) => setUploadCategory(e.target.value as MediaCategory)}
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          >
            <option value="image">دسته: تصویر</option>
            <option value="logo">دسته: لوگو</option>
            <option value="brand_asset">دسته: فایل برند</option>
            <option value="thumbnail">دسته: کاور / تامبنیل</option>
            <option value="document">دسته: سند</option>
          </select>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span>بارگذاری فایل</span>
            <input type="file" onChange={handleFileChange} className="hidden" />
          </label>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {filtered.length === 0 ? (
        <EmptyState
          title="کتابخانه رسانه خالی است"
          description="تصاویر، لوگو، کاور ریلز یا اسناد برند خود را بارگذاری کنید تا در استودیو محتوا به آن‌ها دسترسی داشته باشید."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map((asset) => (
            <div key={asset.id} className="bg-[#151E33] border border-[#273449] rounded-xl overflow-hidden flex flex-col">
              <div className="h-40 bg-[#0B1020] flex items-center justify-center overflow-hidden">
                {asset.previewUrl ? (
                  <img
                    src={asset.previewUrl}
                    alt={asset.fileName}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : asset.mimeType.startsWith('image/') ? (
                  <ImageIcon className="w-8 h-8 text-[#94A3B8]" />
                ) : (
                  <FileText className="w-8 h-8 text-[#94A3B8]" />
                )}
              </div>
              <div className="p-3.5 space-y-2 flex-1 flex flex-col justify-between">
                {renamingId === asset.id ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (renameValue.trim()) {
                        await updateMediaAsset(business.id, asset.id, { fileName: renameValue.trim() });
                      }
                      setRenamingId(null);
                    }}
                    className="flex gap-1.5"
                  >
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 bg-[#0B1020] border border-[#6366F1] rounded px-2 py-1 text-xs outline-none"
                    />
                    <button type="submit" className="text-xs text-[#22C55E] px-2">ثبت</button>
                  </form>
                ) : (
                  <div
                    onClick={() => {
                      setRenamingId(asset.id);
                      setRenameValue(asset.fileName);
                    }}
                    title="برای تغییر نام کلیک کنید"
                    className="text-xs font-medium text-[#F8FAFC] truncate cursor-pointer hover:text-[#8B5CF6]"
                  >
                    {asset.fileName}
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-[#94A3B8] pt-2 border-t border-[#273449] tabular-nums">
                  <span>
                    {formatNumber(Math.max(1, Math.round(asset.fileSize / 1024)), locale, numeralStyle)} KB · {formatJalaliDate(asset.createdAt, locale, numeralStyle)}
                  </span>
                  <button
                    onClick={() => setDeleteTarget(asset)}
                    className="text-[#94A3B8] hover:text-[#EF4444]"
                    aria-label="حذف فایل"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="حذف فایل رسانه"
        description={t.common.confirmDelete}
        confirmLabel="حذف"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteMediaAsset(business.id, deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
