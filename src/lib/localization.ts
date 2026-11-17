import type { CurrencyCode, LocaleCode, NumeralStyle } from '../types/domain';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

export function toLatinDigits(value: string | number): string {
  return String(value)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

export function formatDigits(value: string | number, style: NumeralStyle = 'persian'): string {
  return style === 'persian' ? toPersianDigits(value) : toLatinDigits(value);
}

export function formatNumber(
  num: number,
  locale: LocaleCode = 'fa',
  numeralStyle: NumeralStyle = 'persian'
): string {
  const safe = Number.isFinite(num) ? num : 0;
  const formatted = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(safe);
  return numeralStyle === 'latin' ? toLatinDigits(formatted) : toPersianDigits(formatted);
}

export function formatCurrency(
  amount: number,
  currency: CurrencyCode = 'IRT',
  locale: LocaleCode = 'fa',
  numeralStyle: NumeralStyle = 'persian'
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const formattedNum = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(safe);
  const localizedNum = numeralStyle === 'latin' ? toLatinDigits(formattedNum) : toPersianDigits(formattedNum);

  if (currency === 'IRT') {
    return locale === 'fa' ? `${localizedNum} تومان` : `${localizedNum} Toman`;
  }
  if (currency === 'IRR') {
    return locale === 'fa' ? `${localizedNum} ریال` : `${localizedNum} IRR`;
  }
  return `$${localizedNum}`;
}

export function normalizeIranPhone(raw: string): string {
  const digits = toLatinDigits(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+98') && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith('98') && digits.length === 12) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

export function isValidIranPhone(raw: string): boolean {
  if (!raw.trim()) return true;
  const normalized = normalizeIranPhone(raw);
  return /^09\d{9}$/.test(normalized);
}

export function formatIranPhoneDisplay(raw: string, numeralStyle: NumeralStyle = 'persian'): string {
  const normalized = normalizeIranPhone(raw);
  if (/^09\d{9}$/.test(normalized)) {
    const grouped = `${normalized.slice(0, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7)}`;
    return formatDigits(grouped, numeralStyle);
  }
  return formatDigits(raw, numeralStyle);
}

// ============================================================================
// Pure TypeScript Jalali (Solar Hijri) Calendar Utilities
// ============================================================================

export const JALALI_MONTHS_FA = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export const JALALI_MONTHS_EN = [
  'Farvardin',
  'Ordibehesht',
  'Khordad',
  'Tir',
  'Mordad',
  'Shahrivar',
  'Mehr',
  'Aban',
  'Azar',
  'Dey',
  'Bahman',
  'Esfand',
];

export const PERSIAN_WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
export const PERSIAN_WEEKDAYS_FULL = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
];

export function isJalaliLeapYear(jy: number): boolean {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
    2192, 2262, 2324, 2394, 2456, 3178,
  ];
  let bl = breaks.length;
  let jp = breaks[0];
  let jump = 0;
  let leap = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    jp = jm;
  }
  let n = jy - jp;
  if (jump - n < 6) n = n - jump + Math.floor((jump + 4) / 33) * 33;
  leap = ((n + 1) % 33 - 1) % 4;
  if (leap === -1) leap = 4;
  return leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

export function gregorianToJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  let jyAdj = jy + 1595;
  let days =
    -355668 +
    365 * jyAdj +
    Math.floor(jyAdj / 33) * 8 +
    Math.floor(((jyAdj % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let gm = 0;
  for (gm = 0; gm < 13 && gd > sal_a[gm]; gm++) {
    gd -= sal_a[gm];
  }
  return { gy, gm, gd };
}

export function toIsoGregorian(gy: number, gm: number, gd: number): string {
  return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

export function jalaliToIsoGregorian(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  return toIsoGregorian(gy, gm, gd);
}

export function isoGregorianToJalali(iso: string): { jy: number; jm: number; jd: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return gregorianToJalali(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function resolveDateValue(input: unknown): Date | null {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === 'string' || typeof input === 'number') {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'object' && input !== null && 'toDate' in input && typeof (input as { toDate: () => Date }).toDate === 'function') {
    return (input as { toDate: () => Date }).toDate();
  }
  if (typeof input === 'object' && input !== null && 'seconds' in input) {
    return new Date(Number((input as { seconds: number }).seconds) * 1000);
  }
  return null;
}

export function formatJalaliDate(
  input: unknown,
  locale: LocaleCode = 'fa',
  numeralStyle: NumeralStyle = 'persian'
): string {
  const d = resolveDateValue(input);
  if (!d) return locale === 'fa' ? 'نامشخص' : 'Unknown';
  const { jy, jm, jd } = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  if (locale === 'en') {
    return `${JALALI_MONTHS_EN[jm - 1]} ${jd}, ${jy}`;
  }
  const text = `${jd} ${JALALI_MONTHS_FA[jm - 1]} ${jy}`;
  return formatDigits(text, numeralStyle);
}

export function formatJalaliDateTime(
  input: unknown,
  locale: LocaleCode = 'fa',
  numeralStyle: NumeralStyle = 'persian'
): string {
  const d = resolveDateValue(input);
  if (!d) return locale === 'fa' ? 'نامشخص' : 'Unknown';
  const datePart = formatJalaliDate(d, locale, numeralStyle);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const timePart = formatDigits(`${hh}:${mm}`, numeralStyle);
  return locale === 'fa' ? `${datePart} · ${timePart}` : `${datePart} · ${timePart}`;
}

export function getPersianDayIndex(date: Date): number {
  // JS getDay(): 0=Sun..6=Sat -> Persian week: 0=Sat(شنبه), 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri
  return (date.getDay() + 1) % 7;
}

export function getJalaliMonthGrid(jy: number, jm: number): Array<{
  jy: number;
  jm: number;
  jd: number;
  iso: string;
  isCurrentMonth: boolean;
}> {
  const daysInMonth = jalaliMonthLength(jy, jm);
  const firstGreg = jalaliToGregorian(jy, jm, 1);
  const firstDate = new Date(firstGreg.gy, firstGreg.gm - 1, firstGreg.gd);
  const startOffset = getPersianDayIndex(firstDate);

  const prevMonth = jm === 1 ? 12 : jm - 1;
  const prevYear = jm === 1 ? jy - 1 : jy;
  const prevMonthLen = jalaliMonthLength(prevYear, prevMonth);

  const cells: Array<{ jy: number; jm: number; jd: number; iso: string; isCurrentMonth: boolean }> = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const jd = prevMonthLen - i;
    cells.push({
      jy: prevYear,
      jm: prevMonth,
      jd,
      iso: jalaliToIsoGregorian(prevYear, prevMonth, jd),
      isCurrentMonth: false,
    });
  }

  for (let jd = 1; jd <= daysInMonth; jd++) {
    cells.push({
      jy,
      jm,
      jd,
      iso: jalaliToIsoGregorian(jy, jm, jd),
      isCurrentMonth: true,
    });
  }

  const nextMonth = jm === 12 ? 1 : jm + 1;
  const nextYear = jm === 12 ? jy + 1 : jy;
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      jy: nextYear,
      jm: nextMonth,
      jd: nextDay,
      iso: jalaliToIsoGregorian(nextYear, nextMonth, nextDay),
      isCurrentMonth: false,
    });
    nextDay++;
  }

  return cells;
}

export function canonicalizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizePayload(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const v = record[key];
      if (v !== undefined) {
        result[key] = canonicalizePayload(v);
      }
    }
    return result;
  }
  return value;
}

export function canonicalStringify(payload: unknown): string {
  return JSON.stringify(canonicalizePayload(payload ?? {}));
}

export async function computePayloadHash(payload: unknown): Promise<string> {
  const text = canonicalStringify(payload);
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function slugifyText(input: string): string {
  const cleaned = toLatinDigits(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return cleaned || `creator-${Date.now().toString(36)}`;
}
