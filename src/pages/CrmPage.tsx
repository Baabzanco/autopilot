import React, { useState } from 'react';
import { Download, Loader2, Mail, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { draftCrmCustomerReply } from '../services/apiClient';
import {
  createApprovalRequest,
  createContact,
  deleteContact,
  updateContact,
} from '../services/dataAccess';
import {
  formatCurrency,
  formatIranPhoneDisplay,
  formatJalaliDate,
  formatNumber,
  isValidIranPhone,
  normalizeIranPhone,
} from '../lib/localization';
import type { Business, Contact, ContactType, Order, PipelineStage } from '../types/domain';
import { ConfirmationDialog, EmptyState, ErrorState } from '../components/ui/Primitives';

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  audience_member: 'مخاطب',
  lead: 'سرنخ (لید)',
  customer: 'مشتری',
  partner: 'همکار',
  brand_contact: 'نماینده برند',
};

const STAGE_LABELS: Record<PipelineStage, string> = {
  new: 'جدید',
  interested: 'علاقه‌مند',
  qualified: 'واجد شرایط',
  customer: 'مشتری فعال',
  inactive: 'غیرفعال',
  archived: 'بایگانی',
};

export function CrmPage({
  business,
  ownerId,
  contacts,
  orders,
}: {
  business: Business;
  ownerId: string;
  contacts: Contact[];
  orders: Order[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [socialPlatform, setSocialPlatform] = useState('instagram');
  const [socialUsername, setSocialUsername] = useState('');
  const [contactType, setContactType] = useState<ContactType>('lead');
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('new');
  const [tagsInput, setTagsInput] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [inquiryInput, setInquiryInput] = useState('');
  const [draftingReply, setDraftingReply] = useState(false);
  const [draftFeedback, setDraftFeedback] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) {
      setError('نام کامل مخاطب الزامی است.');
      return;
    }
    if (!isValidIranPhone(phone)) {
      setError('قالب شماره موبایل ایران معتبر نیست (مثال: 09123456789).');
      return;
    }
    const normalizedPhone = normalizeIranPhone(phone);
    const normalizedEmail = email.trim().toLowerCase();
    const duplicate = contacts.find(
      (c) =>
        (normalizedPhone && c.phone && normalizeIranPhone(c.phone) === normalizedPhone) ||
        (normalizedEmail && c.email && c.email.trim().toLowerCase() === normalizedEmail)
    );
    if (duplicate) {
      setError(`مخاطبی با همین شماره موبایل یا ایمیل قبلاً با نام «${duplicate.fullName}» ثبت شده است.`);
      return;
    }
    await createContact(business.id, ownerId, {
      fullName: fullName.trim(),
      email: email.trim(),
      phone: normalizedPhone,
      socialPlatform,
      socialUsername: socialUsername.trim(),
      source: 'ثبت مستقیم در CRM',
      contactType,
      pipelineStage,
      tags: tagsInput.split(/[،,]+/).map((s) => s.trim()).filter(Boolean),
      notes: notes.trim(),
      consentStatus: 'subscribed',
      totalSpent: 0,
    });
    setFullName('');
    setEmail('');
    setPhone('');
    setSocialUsername('');
    setTagsInput('');
    setNotes('');
    setShowAdd(false);
  };

  const handleDraftAiReply = async () => {
    if (!selectedContact || !inquiryInput.trim()) return;
    setDraftingReply(true);
    setError(null);
    setDraftFeedback(null);
    try {
      const res = await draftCrmCustomerReply({
        customerName: selectedContact.fullName,
        inquiry: inquiryInput.trim(),
        business,
      });
      await createApprovalRequest(business.id, ownerId, {
        category: 'customer_reply',
        actionTitle: `پاسخ به مشتری: ${selectedContact.fullName}`,
        requestingAgentName: 'ایجنت ارتباط با مشتری',
        targetPlatform: selectedContact.email || selectedContact.socialPlatform || 'CRM',
        reason: 'پیش‌نویس پاسخ آماده شد؛ ارسال پیام نیازمند تأیید صریح شماست.',
        payloadSummary: `موضوع: ${res.subject}\n\nمتن پیشنهادی:\n${res.replyDraft}`,
        relatedEntityType: 'contact',
        relatedEntityId: selectedContact.id,
      });
      setInquiryInput('');
      setDraftFeedback('پیش‌نویس پاسخ توسط ایجنت آماده و برای تأیید به «مرکز تأییدها» ارسال شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تولید پیش‌نویس پاسخ');
    } finally {
      setDraftingReply(false);
    }
  };

  const handleExportContacts = () => {
    const blob = new Blob([JSON.stringify(contacts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-contacts-${business.slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = contacts.filter((c) => {
    if (stageFilter !== 'all' && c.pipelineStage !== stageFilter) return false;
    if (typeFilter !== 'all' && c.contactType !== typeFilter) return false;
    if (
      search.trim() &&
      !c.fullName.toLowerCase().includes(search.trim().toLowerCase()) &&
      !(c.email || '').toLowerCase().includes(search.trim().toLowerCase()) &&
      !(c.phone || '').includes(search.trim())
    ) {
      return false;
    }
    return true;
  });

  const contactOrders = selectedContact
    ? orders.filter((o) => o.customerEmail && selectedContact.email && o.customerEmail === selectedContact.email)
    : [];

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو نام، ایمیل یا موبایل..."
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none w-56"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          >
            <option value="all">همه انواع مخاطب</option>
            {Object.entries(CONTACT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          >
            <option value="all">همه مراحل قیف</option>
            {Object.entries(STAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportContacts}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#151E33] border border-[#273449] hover:border-[#3B4D6B] text-xs rounded-lg whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>خروجی JSON</span>
          </button>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>افزودن مخاطب</span>
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {showAdd && (
        <form onSubmit={handleCreate} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[#F8FAFC]">ثبت مخاطب یا مشتری جدید</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="نام و نام خانوادگی *"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            />
            <input
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09123456789"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none text-left"
            />
            <input
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none text-left"
            />
            <select
              value={contactType}
              onChange={(e) => setContactType(e.target.value as ContactType)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              {Object.entries(CONTACT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={pipelineStage}
              onChange={(e) => setPipelineStage(e.target.value as PipelineStage)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              {Object.entries(STAGE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <select
                value={socialPlatform}
                onChange={(e) => setSocialPlatform(e.target.value)}
                className="bg-[#0B1020] border border-[#273449] rounded-lg px-2 py-2 text-xs outline-none"
              >
                <option value="instagram">اینستاگرام</option>
                <option value="telegram">تلگرام</option>
                <option value="linkedin">لینکدین</option>
              </select>
              <input
                dir="ltr"
                value={socialUsername}
                onChange={(e) => setSocialUsername(e.target.value)}
                placeholder="@username"
                className="flex-1 bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none text-left"
              />
            </div>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="برچسب‌ها (مثلاً: دوره طراحی، ویژه)"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2 lg:col-span-3"
            />
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="یادداشت و سابقه تعامل..."
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2 lg:col-span-3"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-[#94A3B8]">انصراف</button>
            <button type="submit" className="px-4 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg">ثبت مخاطب</button>
          </div>
        </form>
      )}

      {contacts.length === 0 ? (
        <EmptyState
          title="هیچ مخاطبی در CRM ثبت نشده است"
          description="مخاطبان، سرنخ‌ها و مشتریان خود را ثبت کنید تا ایجنت ارتباط با مشتری بتواند پیش‌نویس پاسخ‌های دقیق برای آن‌ها آماده کند."
          actionLabel="افزودن اولین مخاطب"
          onAction={() => setShowAdd(true)}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Contacts Table */}
          <div className="lg:col-span-7 bg-[#151E33] border border-[#273449] rounded-xl overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-[#273449] text-[#94A3B8]">
                <tr>
                  <th className="py-3 px-4 font-medium">نام</th>
                  <th className="py-3 px-4 font-medium">تماس</th>
                  <th className="py-3 px-4 font-medium">نوع / مرحله</th>
                  <th className="py-3 px-4 font-medium">اقدام</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#273449]">
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedContact(c)}
                    className={`cursor-pointer transition-colors ${
                      selectedContact?.id === c.id ? 'bg-[#6366F1]/10' : 'hover:bg-[#11182A]'
                    }`}
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#F8FAFC]">{c.fullName}</div>
                      {(c.tags || []).length > 0 && (
                        <div className="text-[11px] text-[#94A3B8] mt-0.5">{c.tags?.join(' · ')}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-[#94A3B8]">
                      <div>{c.phone ? formatIranPhoneDisplay(c.phone, numeralStyle) : c.email || '—'}</div>
                      {c.socialUsername && <div dir="ltr" className="text-[11px]">{c.socialUsername}</div>}
                    </td>
                    <td className="py-3 px-4 text-[#94A3B8]">
                      {CONTACT_TYPE_LABELS[c.contactType]} · {STAGE_LABELS[c.pipelineStage]}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(c);
                        }}
                        className="text-[#94A3B8] hover:text-[#EF4444]"
                        aria-label="حذف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Customer Profile & AI Reply Drafter */}
          <div className="lg:col-span-5 bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
            {!selectedContact ? (
              <div className="py-16 text-center text-xs text-[#94A3B8]">
                برای مشاهده پرونده و نگارش پاسخ هوشمند، یک مخاطب را انتخاب کنید.
              </div>
            ) : (
              <>
                <div className="border-b border-[#273449] pb-3 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-[#F8FAFC]">{selectedContact.fullName}</h3>
                    <div className="text-xs text-[#94A3B8] mt-0.5">
                      ثبت‌شده در {formatJalaliDate(selectedContact.createdAt, locale, numeralStyle)}
                    </div>
                  </div>
                  <select
                    value={selectedContact.pipelineStage}
                    onChange={async (e) => {
                      const nextStage = e.target.value as PipelineStage;
                      await updateContact(business.id, selectedContact.id, { pipelineStage: nextStage });
                      setSelectedContact({ ...selectedContact, pipelineStage: nextStage });
                    }}
                    className="bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1 text-xs outline-none"
                  >
                    {Object.entries(STAGE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5 text-xs text-[#94A3B8]">
                  <div>تلفن: {selectedContact.phone ? formatIranPhoneDisplay(selectedContact.phone, numeralStyle) : 'ثبت نشده'}</div>
                  <div>ایمیل: {selectedContact.email || 'ثبت نشده'}</div>
                  <div>یادداشت: {selectedContact.notes || 'ندارد'}</div>
                  <div>
                    وضعیت رضایت پیام: {selectedContact.consentStatus === 'subscribed' ? 'مجاز به دریافت پیام' : 'لغو اشتراک'}
                  </div>
                </div>

                {contactOrders.length > 0 && (
                  <div className="pt-3 border-t border-[#273449] space-y-2">
                    <div className="text-xs font-semibold text-[#F8FAFC]">سابقه خرید ({formatNumber(contactOrders.length, locale, numeralStyle)})</div>
                    {contactOrders.map((ord) => (
                      <div key={ord.id} className="text-xs text-[#94A3B8] flex justify-between">
                        <span>{ord.productName}</span>
                        <span className="tabular-nums">{formatCurrency(ord.total, ord.currency, locale, numeralStyle)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* AI Customer Relationship Reply Drafter */}
                <div className="pt-3 border-t border-[#273449] space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F8FAFC]">
                    <Mail className="w-3.5 h-3.5 text-[#8B5CF6]" />
                    <span>تهیه پیش‌نویس پاسخ با ایجنت CRM (نیازمند تأیید شما)</span>
                  </div>
                  <textarea
                    rows={3}
                    value={inquiryInput}
                    onChange={(e) => setInquiryInput(e.target.value)}
                    placeholder="سوال یا پیام این مخاطب را بنویسید..."
                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleDraftAiReply}
                    disabled={draftingReply || !inquiryInput.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                  >
                    {draftingReply ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>تولید پیش‌نویس و ارسال به مرکز تأییدها</span>
                  </button>
                  {draftFeedback && <div className="text-xs text-[#22C55E]">{draftFeedback}</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="حذف مخاطب از CRM"
        description={t.common.confirmDelete}
        confirmLabel="حذف دائمی"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteContact(business.id, deleteTarget.id);
            if (selectedContact?.id === deleteTarget.id) setSelectedContact(null);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
