import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  canonicalStringify,
  computePayloadHash,
  formatCurrency,
  formatDigits,
  formatIranPhoneDisplay,
  formatJalaliDate,
  formatNumber,
  getJalaliMonthGrid,
  gregorianToJalali,
  isJalaliLeapYear,
  isValidIranPhone,
  jalaliMonthLength,
  jalaliToGregorian,
  normalizeIranPhone,
  toLatinDigits,
  toPersianDigits,
} from '../src/lib/localization.ts';
import { fa } from '../src/i18n/fa.ts';
import { en } from '../src/i18n/en.ts';

describe('1. Persian Localization, RTL & Jalali Calendar Utilities (Section 2)', () => {
  it('converts digits accurately between Persian, Arabic-Indic, and Latin', () => {
    assert.equal(toPersianDigits('1404/01/15'), '۱۴۰۴/۰۱/۱۵');
    assert.equal(toLatinDigits('۱۴۰۴/۰۱/۱۵'), '1404/01/15');
    assert.equal(toLatinDigits('١٤٠٤'), '1404');
    assert.equal(formatDigits(2026, 'persian'), '۲۰۲۶');
    assert.equal(formatDigits('۲۰۲۶', 'latin'), '2026');
  });

  it('formats Toman (IRT), Rial (IRR), and USD currencies with Persian and Latin numerals', () => {
    const irtFa = formatCurrency(1500000, 'IRT', 'fa', 'persian');
    assert.ok(irtFa.includes('تومان'));
    assert.ok(irtFa.includes('۱'));

    const irrFa = formatCurrency(15000000, 'IRR', 'fa', 'persian');
    assert.ok(irrFa.includes('ریال'));

    const irtLatin = formatCurrency(250000, 'IRT', 'fa', 'latin');
    assert.ok(irtLatin.includes('250'));
    assert.ok(irtLatin.includes('تومان'));

    const usd = formatCurrency(49.5, 'USD', 'en', 'latin');
    assert.equal(usd, '$49.5');
  });

  it('validates and normalizes Iranian mobile numbers across +98, 98, and Persian digit formats', () => {
    assert.equal(normalizeIranPhone('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
    assert.equal(normalizeIranPhone('+989123456789'), '09123456789');
    assert.equal(normalizeIranPhone('989351112233'), '09351112233');
    assert.equal(isValidIranPhone('۰۹۱۲۳۴۵۶۷۸۹'), true);
    assert.equal(isValidIranPhone('+989123456789'), true);
    assert.equal(isValidIranPhone('02188776655'), false);
    assert.equal(isValidIranPhone('12345'), false);
    assert.equal(formatIranPhoneDisplay('09123456789', 'persian'), '۰۹۱۲ ۳۴۵ ۶۷۸۹');
  });

  it('converts Gregorian <-> Jalali dates accurately including Nowruz and leap years', () => {
    // 2025-03-21 is 1 Farvardin 1404
    const jNowruz = gregorianToJalali(2025, 3, 21);
    assert.deepEqual(jNowruz, { jy: 1404, jm: 1, jd: 1 });

    const gBack = jalaliToGregorian(1404, 1, 1);
    assert.deepEqual(gBack, { gy: 2025, gm: 3, gd: 21 });

    // 1403 is a leap year (Esfand has 30 days), 1404 is a normal year (Esfand has 29 days)
    assert.equal(isJalaliLeapYear(1403), true);
    assert.equal(jalaliMonthLength(1403, 12), 30);
    assert.equal(isJalaliLeapYear(1404), false);
    assert.equal(jalaliMonthLength(1404, 12), 29);

    const grid = getJalaliMonthGrid(1404, 1);
    assert.equal(grid.length % 7, 0);
    const currentMonthDays = grid.filter((c) => c.isCurrentMonth);
    assert.equal(currentMonthDays.length, 31);
  });

  it('maintains complete i18n dictionary parity between Persian (fa) and English (en)', () => {
    assert.deepEqual(Object.keys(fa).sort(), Object.keys(en).sort());
    assert.deepEqual(Object.keys(fa.nav).sort(), Object.keys(en.nav).sort());
    assert.deepEqual(Object.keys(fa.statuses).sort(), Object.keys(en.statuses).sort());
    assert.equal(formatNumber(1250, 'fa', 'persian').length > 0, true);
    assert.ok(formatJalaliDate('2025-03-21T10:00:00.000Z', 'fa', 'persian').includes('فروردین'));
  });
});

describe('2. Cryptographic Approval Hash & Payload Tampering Detection (Tests D & E)', () => {
  it('produces identical canonical SHA-256 hashes regardless of object key insertion order', async () => {
    const payloadA = {
      actionTitle: 'انتشار پست اینستاگرام',
      category: 'content_publication',
      payloadData: { platform: 'instagram', contentId: 'cnt_123' },
      payloadSummary: 'کپشن نهایی با نیم‌فاصله استاندارد',
    };
    const payloadB = {
      payloadSummary: 'کپشن نهایی با نیم‌فاصله استاندارد',
      payloadData: { contentId: 'cnt_123', platform: 'instagram' },
      category: 'content_publication',
      actionTitle: 'انتشار پست اینستاگرام',
    };

    assert.equal(canonicalStringify(payloadA), canonicalStringify(payloadB));
    const hashA = await computePayloadHash(payloadA);
    const hashB = await computePayloadHash(payloadB);
    assert.equal(hashA, hashB);
    assert.equal(hashA.length, 64);
  });

  it('detects any modification to an approved payload (Test E — Modified Payload Invalidates Approval)', async () => {
    const approvedPayload = {
      actionTitle: 'تغییر قیمت دوره آموزشی',
      category: 'price_change',
      payloadSummary: 'قیمت: ۱٬۵۰۰٬۰۰۰ تومان',
      payloadData: { price: 1500000, currency: 'IRT' },
    };
    const tamperedPayload = {
      ...approvedPayload,
      payloadSummary: 'قیمت: ۹٬۵۰۰٬۰۰۰ تومان',
      payloadData: { price: 9500000, currency: 'IRT' },
    };

    const originalHash = await computePayloadHash(approvedPayload);
    const tamperedHash = await computePayloadHash(tamperedPayload);
    assert.notEqual(originalHash, tamperedHash);
  });
});

describe('3. Firestore Security Rules Invariants & Tenant Isolation (Test B & Section 5)', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

  it('enforces default-deny catch-all rule and never uses wildcards with allow read, write: if true', () => {
    assert.ok(rulesContent.includes('match /{document=**}'));
    assert.ok(rulesContent.includes('allow read, write: if false;'));
    assert.equal(/allow\s+read,\s*write:\s*if\s*true/i.test(rulesContent), false);
  });

  it('requires verified email and strict ownerId matching across users, businesses, and all 16 subcollections', () => {
    assert.ok(rulesContent.includes('request.auth.token.email_verified == true'));
    assert.ok(rulesContent.includes('function isBusinessOwner(businessId)'));
    assert.ok(rulesContent.includes('resource.data.ownerId == request.auth.uid'));
    assert.ok(rulesContent.includes('data.ownerId == request.auth.uid'));
    assert.ok(rulesContent.includes('data.businessId == businessId'));
  });

  it('enforces immutable append-only audit logs and terminal state locks on approvals, tasks, and orders', () => {
    assert.ok(rulesContent.includes('match /activityLogs/{logId}'));
    assert.ok(rulesContent.includes('allow update, delete: if false;'));
    // Terminal state lock on approvals
    assert.ok(rulesContent.includes("!(existing().status in ['approved', 'rejected', 'expired'])"));
    assert.ok(rulesContent.includes('incoming().payloadHash == existing().payloadHash'));
    // Terminal state lock on tasks & orders
    assert.ok(rulesContent.includes("!(existing().status in ['completed', 'cancelled'])"));
    assert.ok(rulesContent.includes("!(existing().paymentStatus == 'refunded' && existing().fulfillmentStatus == 'delivered')"));
  });
});

describe('4. Backend API Authentication & Security Gate Verification (Section 4 & Test G)', () => {
  const baseUrl = 'http://localhost:3000';

  it('returns healthy status and active Gemini model on GET /api/v1/health', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok: boolean; model: string };
    assert.equal(data.ok, true);
    assert.equal(data.model, 'gemini-4-hydrogen');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-request-id'));
  });

  it('rejects unauthenticated requests to /api/v1/ai/* and /api/v1/approvals/verify-execution with 401', async () => {
    const endpoints = [
      '/api/v1/ai/onboarding-summary',
      '/api/v1/ai/manager/chat',
      '/api/v1/ai/agents/execute',
      '/api/v1/ai/content/generate',
      '/api/v1/ai/content/repurpose',
      '/api/v1/ai/campaigns/draft',
      '/api/v1/ai/analytics/report',
      '/api/v1/ai/crm/draft-reply',
      '/api/v1/approvals/verify-execution',
    ];

    for (const ep of endpoints) {
      const noTokenRes = await fetch(`${baseUrl}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(noTokenRes.status, 401, `Expected 401 on ${ep} without token`);

      const invalidTokenRes = await fetch(`${baseUrl}${ep}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer forged.jwt.token',
        },
        body: JSON.stringify({}),
      });
      assert.equal(invalidTokenRes.status, 401, `Expected 401 on ${ep} with forged token`);
    }
  });
});
