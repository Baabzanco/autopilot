import React, { useState } from 'react';
import { ExternalLink, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  createApprovalRequest,
  createOrderWithIdempotency,
  createProduct,
  deleteProduct,
  updateProduct,
} from '../services/dataAccess';
import { formatCurrency, formatJalaliDateTime, formatNumber } from '../lib/localization';
import type { Business, CurrencyCode, Order, Product, ProductStatus, ProductType } from '../types/domain';
import { ConfirmationDialog, EmptyState, StatusIndicator } from '../components/ui/Primitives';

const PRODUCT_TYPES: Record<ProductType, string> = {
  digital_download: 'فایل دیجیتال',
  ebook: 'کتاب الکترونیک',
  template: 'قالب و ابزار آماده',
  online_course: 'دوره آموزشی آنلاین',
  consulting: 'مشاوره تخصصی',
  coaching: 'کوچینگ',
  membership: 'اشتراک ویژه',
};

export function ProductsPage({
  business,
  ownerId,
  products,
  orders,
}: {
  business: Business;
  ownerId: string;
  products: Product[];
  orders: Order[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [productType, setProductType] = useState<ProductType>('digital_download');
  const [price, setPrice] = useState('290000');
  const [currency, setCurrency] = useState<CurrencyCode>(business.currency || 'IRT');
  const [deliveryNote, setDeliveryNote] = useState('لینک دانلود پس از تأیید پرداخت نمایش داده می‌شود.');

  const [priceEditProduct, setPriceEditProduct] = useState<Product | null>(null);
  const [newPriceValue, setNewPriceValue] = useState('');
  const [priceNotice, setPriceNotice] = useState<string | null>(null);

  const [showStorefront, setShowStorefront] = useState(false);
  const [checkoutProduct, setCheckoutProduct] = useState<Product | null>(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createProduct(business.id, ownerId, {
      name: name.trim(),
      description: description.trim(),
      productType,
      price: Math.max(0, Number(price) || 0),
      currency,
      deliveryNote: deliveryNote.trim(),
      status: 'draft',
    });
    setName('');
    setDescription('');
    setShowAdd(false);
  };

  const handleRequestPriceChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!priceEditProduct) return;
    const nextPrice = Math.max(0, Number(newPriceValue) || 0);
    await updateProduct(business.id, priceEditProduct.id, { pendingPrice: nextPrice });
    await createApprovalRequest(business.id, ownerId, {
      category: 'price_change',
      actionTitle: `تغییر قیمت محصول «${priceEditProduct.name}»`,
      requestingAgentName: 'مالک کسب‌وکار',
      targetPlatform: 'فروشگاه سازنده',
      reason: 'تغییر قیمت عمومی محصول نیازمند تأیید صریح قبل از اعمال است.',
      payloadSummary: `قیمت فعلی: ${formatCurrency(priceEditProduct.price, priceEditProduct.currency, locale, numeralStyle)}\nقیمت جدید پیشنهادی: ${formatCurrency(nextPrice, priceEditProduct.currency, locale, numeralStyle)}`,
      payloadData: { productId: priceEditProduct.id, newPrice: nextPrice },
      relatedEntityType: 'product',
      relatedEntityId: priceEditProduct.id,
    });
    setPriceEditProduct(null);
    setPriceNotice('درخواست تغییر قیمت به «مرکز تأییدها» ارسال شد و پس از تأیید اعمال می‌شود.');
  };

  const handleTestCheckoutOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutProduct || !buyerName.trim()) return;
    const idempotencyKey = `${checkoutProduct.id}_${Date.now()}`;
    const orderId = await createOrderWithIdempotency(business.id, ownerId, {
      idempotencyKey,
      product: checkoutProduct,
      customerName: buyerName.trim(),
      customerEmail: buyerEmail.trim(),
      paymentProvider: 'manual_test_checkout',
      paymentStatus: 'paid',
    });
    setOrderNotice(`سفارش با شناسه ${orderId} ثبت و وضعیت تحویل محصول تکمیل شد.`);
    setBuyerName('');
    setBuyerEmail('');
    setCheckoutProduct(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-[#94A3B8]">
          {formatNumber(products.length, locale, numeralStyle)} محصول · {formatNumber(orders.length, locale, numeralStyle)} سفارش ثبت‌شده
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowStorefront(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#151E33] border border-[#273449] hover:border-[#6366F1] text-xs font-medium rounded-lg whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>پیش‌نمایش فروشگاه عمومی</span>
          </button>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>افزودن محصول جدید</span>
          </button>
        </div>
      </div>

      {priceNotice && (
        <div className="p-3 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#F59E0B]">
          {priceNotice}
        </div>
      )}
      {orderNotice && (
        <div className="p-3 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E]">
          {orderNotice}
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleCreateProduct} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[#F8FAFC]">ایجاد محصول یا خدمت جدید</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="نام محصول *"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2"
            />
            <select
              value={productType}
              onChange={(e) => setProductType(e.target.value as ProductType)}
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
            >
              {Object.entries(PRODUCT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="flex-1 bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none tabular-nums"
              />
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="bg-[#0B1020] border border-[#273449] rounded-lg px-2 py-2 text-xs outline-none"
              >
                <option value="IRT">تومان</option>
                <option value="IRR">ریال</option>
                <option value="USD">دلار</option>
              </select>
            </div>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="توضیحات محصول و مزایا برای مخاطب..."
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2 lg:col-span-4"
            />
            <input
              value={deliveryNote}
              onChange={(e) => setDeliveryNote(e.target.value)}
              placeholder="نحوه تحویل پس از خرید"
              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none sm:col-span-2 lg:col-span-4"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-[#94A3B8]">انصراف</button>
            <button type="submit" className="px-4 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg">ایجاد محصول</button>
          </div>
        </form>
      )}

      {products.length === 0 ? (
        <EmptyState
          title="هنوز محصولی تعریف نکرده‌اید"
          description="محصولات دیجیتال، دوره‌ها یا جلسات مشاوره خود را اضافه کنید تا در فروشگاه عمومی و کمپین‌ها استفاده شوند."
          actionLabel="ساخت اولین محصول"
          onAction={() => setShowAdd(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <div key={p.id} className="bg-[#151E33] border border-[#273449] rounded-xl p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-[#F8FAFC]">{p.name}</h3>
                    <div className="text-xs text-[#94A3B8] mt-0.5">{PRODUCT_TYPES[p.productType]}</div>
                  </div>
                  <select
                    value={p.status}
                    onChange={(e) => updateProduct(business.id, p.id, { status: e.target.value as ProductStatus })}
                    className="bg-[#0B1020] border border-[#273449] rounded px-2 py-1 text-[11px] outline-none"
                  >
                    <option value="draft">پیش‌نویس</option>
                    <option value="active">فعال</option>
                    <option value="inactive">غیرفعال</option>
                  </select>
                </div>
                <p className="text-xs text-[#94A3B8] line-clamp-2">{p.description || 'بدون توضیح'}</p>
              </div>

              <div className="space-y-3 pt-3 border-t border-[#273449]">
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold text-[#F8FAFC] tabular-nums">
                    {formatCurrency(p.price, p.currency, locale, numeralStyle)}
                  </span>
                  <span className="text-xs text-[#94A3B8] tabular-nums">
                    {formatNumber(p.salesCount ?? 0, locale, numeralStyle)} فروش
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPriceEditProduct(p);
                      setNewPriceValue(String(p.price));
                    }}
                    className="text-xs text-[#8B5CF6] hover:underline"
                  >
                    درخواست تغییر قیمت
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(p)}
                    className="text-[#94A3B8] hover:text-[#EF4444]"
                    aria-label="حذف محصول"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Price Change Confirmation Modal */}
      {priceEditProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleRequestPriceChange} className="bg-[#151E33] border border-[#273449] rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-[#F8FAFC]">تغییر قیمت: {priceEditProduct.name}</h3>
            <p className="text-xs text-[#94A3B8]">
              مطابق سیاست نظارت انسانی، تغییر قیمت عمومی ابتدا در مرکز تأییدها ثبت و با تأیید نهایی شما اعمال می‌شود.
            </p>
            <input
              type="number"
              min={0}
              value={newPriceValue}
              onChange={(e) => setNewPriceValue(e.target.value)}
              className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPriceEditProduct(null)} className="px-3 py-1.5 text-xs text-[#94A3B8]">انصراف</button>
              <button type="submit" className="px-4 py-2 bg-[#6366F1] text-white text-xs font-semibold rounded-lg">ارسال برای تأیید</button>
            </div>
          </form>
        </div>
      )}

      {/* Orders Table */}
      <div className="bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[#F8FAFC]">سفارش‌های ثبت‌شده</h3>
        {orders.length === 0 ? (
          <div className="text-xs text-[#94A3B8] py-4">هنوز سفارشی ثبت نشده است.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-[#273449] text-[#94A3B8]">
                <tr>
                  <th className="py-2.5 px-3">شماره سفارش</th>
                  <th className="py-2.5 px-3">مشتری</th>
                  <th className="py-2.5 px-3">محصول</th>
                  <th className="py-2.5 px-3">مبلغ</th>
                  <th className="py-2.5 px-3">وضعیت پرداخت</th>
                  <th className="py-2.5 px-3">تاریخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#273449]">
                {orders.map((ord) => (
                  <tr key={ord.id}>
                    <td className="py-2.5 px-3 font-mono">{ord.orderNumber}</td>
                    <td className="py-2.5 px-3">{ord.customerName || '—'}</td>
                    <td className="py-2.5 px-3">{ord.productName}</td>
                    <td className="py-2.5 px-3 tabular-nums">{formatCurrency(ord.total, ord.currency, locale, numeralStyle)}</td>
                    <td className="py-2.5 px-3"><StatusIndicator status={ord.paymentStatus} label={ord.paymentStatus === 'paid' ? 'پرداخت موفق' : ord.paymentStatus} /></td>
                    <td className="py-2.5 px-3 tabular-nums text-[#94A3B8]">{formatJalaliDateTime(ord.createdAt, locale, numeralStyle)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Responsive Creator Storefront Preview */}
      {showStorefront && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#0B1020] border border-[#273449] rounded-xl max-w-3xl w-full p-6 space-y-6 my-8">
            <div className="flex items-start justify-between gap-4 border-b border-[#273449] pb-4">
              <div>
                <div className="text-xs text-[#8B5CF6]">پیش‌نمایش فروشگاه سازنده</div>
                <h3 className="text-lg font-bold text-[#F8FAFC] mt-0.5">{business.name}</h3>
                <p className="text-xs text-[#94A3B8] mt-1">{business.description}</p>
              </div>
              <button onClick={() => setShowStorefront(false)} className="text-xs text-[#94A3B8] hover:text-[#F8FAFC]">بستن</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {products.filter((p) => p.status === 'active').length === 0 ? (
                <div className="sm:col-span-2 text-xs text-[#94A3B8] py-8 text-center">
                  محصولی با وضعیت «فعال» برای نمایش عمومی وجود ندارد.
                </div>
              ) : (
                products
                  .filter((p) => p.status === 'active')
                  .map((p) => (
                    <div key={p.id} className="bg-[#151E33] border border-[#273449] rounded-xl p-4 space-y-3">
                      <div className="text-sm font-semibold text-[#F8FAFC]">{p.name}</div>
                      <p className="text-xs text-[#94A3B8]">{p.description}</p>
                      <div className="flex items-center justify-between pt-2 border-t border-[#273449]">
                        <span className="text-sm font-bold tabular-nums">
                          {formatCurrency(p.price, p.currency, locale, numeralStyle)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setCheckoutProduct(p)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6366F1] text-white text-xs font-medium rounded-lg"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          <span>ثبت سفارش آزمایشی</span>
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {checkoutProduct && (
              <form onSubmit={handleTestCheckoutOrder} className="bg-[#151E33] border border-[#6366F1] rounded-xl p-4 space-y-3">
                <div className="text-xs font-semibold text-[#F8FAFC]">
                  ثبت سفارش برای «{checkoutProduct.name}» (حالت آزمایشی — درگاه بانکی متصل نیست)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="نام خریدار *"
                    className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                  />
                  <input
                    dir="ltr"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="buyer@example.com"
                    className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none text-left"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setCheckoutProduct(null)} className="text-xs text-[#94A3B8] px-3 py-1.5">انصراف</button>
                  <button type="submit" className="px-4 py-2 bg-[#22C55E] text-[#0B1020] text-xs font-bold rounded-lg">
                    ثبت سفارش و تحویل دیجیتال
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="حذف محصول"
        description={t.common.confirmDelete}
        confirmLabel="حذف"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteProduct(business.id, deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
