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

  it('rejects unauthenticated requests to Phase 1 admin and business AI settings endpoints with 401', async () => {
    const getEndpoints = ['/api/v1/auth/me', '/api/v1/admin/ai/overview'];
    for (const ep of getEndpoints) {
      const res = await fetch(`${baseUrl}${ep}`);
      assert.equal(res.status, 401, `Expected 401 on GET ${ep}`);
    }

    const postEndpoints = [
      '/api/v1/admin/ai/providers',
      '/api/v1/admin/ai/models',
      '/api/v1/admin/ai/policy',
      '/api/v1/business/ai-settings/get',
      '/api/v1/business/ai-settings/update',
      '/api/v1/business/ai-settings/test-key',
    ];
    for (const ep of postEndpoints) {
      const res = await fetch(`${baseUrl}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 401, `Expected 401 on POST ${ep}`);
    }
  });
});

describe('5. Phase 1 Multi-Provider AI Abstraction, Encryption & Capability Routing', () => {
  it('encrypts and decrypts provider credentials with AES-256-GCM and masks previews safely', async () => {
    const { encryptSecret, decryptSecret, maskSecret } = await import('../server/ai/crypto.ts');
    const rawKey = 'sk-proj-super-secret-token-9876543210';
    const blob = encryptSecret(rawKey);

    assert.notEqual(blob.ciphertext, rawKey);
    assert.equal(blob.maskedPreview, maskSecret(rawKey));
    assert.ok(blob.maskedPreview.includes('••••'));
    assert.equal(blob.maskedPreview.includes('super-secret'), false);
    assert.equal(decryptSecret(blob), rawKey);
  });

  it('enforces capability-aware routing, preserves Gemini cascade, and isolates customer credentials per business', async () => {
    const os = await import('node:os');
    const { AiAdminStore } = await import('../server/ai/store.ts');
    const { AiRouter } = await import('../server/ai/router.ts');

    const tmpPath = path.join(os.tmpdir(), `ai-store-test-${Date.now()}.json`);
    try {
      const store = new AiAdminStore(tmpPath);
      const router = new AiRouter(store);

      store.setPlatformCredential('gemini', 'test-gemini-platform-key-1234');
      store.setPlatformCredential('fal', 'test-fal-platform-key-1234');
      store.upsertProvider('fal', { enabled: true });

      // Video generation MUST ONLY select video_generation models (never text-only models)
      const videoCandidates = router.resolveCandidates({
        capability: 'video_generation',
        businessId: 'biz_1',
        ownerId: 'uid_1',
      });
      assert.ok(videoCandidates.length >= 1);
      for (const c of videoCandidates) {
        assert.ok(c.model.capabilities.includes('video_generation'));
        assert.equal(c.model.modelId === 'gemini-4-hydrogen', false);
      }

      // Structured JSON preserves Gemini cascade priority
      const jsonCandidates = router.resolveCandidates({
        capability: 'structured_json',
        businessId: 'biz_1',
        ownerId: 'uid_1',
      });
      assert.deepEqual(
        jsonCandidates.slice(0, 3).map((c) => c.model.modelId),
        ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']
      );

      // Customer credential isolation per businessId + ownerId
      store.updateBusinessSettings({
        businessId: 'biz_customer',
        ownerId: 'uid_a',
        credentialMode: 'customer',
        setCustomerKey: { providerId: 'openai', apiKey: 'sk-customer-only-key-9999' },
      });
      store.upsertProvider('openai', { enabled: true });

      const bizACandidates = router.resolveCandidates({
        capability: 'structured_json',
        businessId: 'biz_customer',
        ownerId: 'uid_a',
      });
      assert.equal(bizACandidates.length, 1);
      assert.equal(bizACandidates[0].credentialSource, 'customer');
      assert.equal(bizACandidates[0].model.providerId, 'openai');

      // Cross-tenant write attempt rejected
      assert.throws(() => {
        store.updateBusinessSettings({
          businessId: 'biz_customer',
          ownerId: 'uid_intruder',
          credentialMode: 'platform',
        });
      }, /CROSS_TENANT_ACCESS_DENIED/);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });
});

describe('6. Image Capability Routing & Explicit Unconfigured Failure (No Text Fallback)', () => {
  it('never selects text-only models for image_generation / image_editing and throws IMAGE_GENERATION_NOT_CONFIGURED when unconfigured', async () => {
    const os = await import('node:os');
    const { AiAdminStore } = await import('../server/ai/store.ts');
    const { AiRouter } = await import('../server/ai/router.ts');

    const tmpPath = path.join(os.tmpdir(), `ai-img-routing-${Date.now()}.json`);
    const prevGeminiEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const store = new AiAdminStore(tmpPath);
      const router = new AiRouter(store);

      // With zero credentials, image generation must fail explicitly with IMAGE_GENERATION_NOT_CONFIGURED
      await assert.rejects(
        () =>
          router.generateImage(
            { requestId: 'req_unconf', businessId: 'biz_1', ownerId: 'uid_1' },
            { prompt: 'studio product photo', aspectRatio: '1:1' }
          ),
        (err: unknown) => {
          const e = err as { code?: string; status?: number };
          return e?.code === 'IMAGE_GENERATION_NOT_CONFIGURED' && e?.status === 503;
        }
      );

      // Enable platform Gemini + OpenAI keys and check strict capability filtering
      store.setPlatformCredential('gemini', 'test-gemini-key-for-routing-1234');
      store.setPlatformCredential('openai', 'sk-test-openai-key-for-routing-1234');
      store.upsertProvider('openai', { enabled: true });

      const genCandidates = router.resolveCandidates({
        capability: 'image_generation',
        businessId: 'biz_1',
        ownerId: 'uid_1',
      });
      assert.ok(genCandidates.length >= 2);
      for (const c of genCandidates) {
        assert.ok(c.model.capabilities.includes('image_generation'));
        assert.equal(c.model.modelId, c.model.modelId);
        assert.equal(['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gpt-4o-mini'].includes(c.model.modelId), false);
      }

      const editCandidates = router.resolveCandidates({
        capability: 'image_editing',
        businessId: 'biz_1',
        ownerId: 'uid_1',
      });
      assert.ok(editCandidates.length >= 1);
      for (const c of editCandidates) {
        assert.ok(c.model.capabilities.includes('image_editing'));
      }
    } finally {
      if (prevGeminiEnv !== undefined) {
        process.env.GEMINI_API_KEY = prevGeminiEnv;
      }
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });
});

describe('7. Persistent Media Store, HMAC URL Isolation, Brand Composition & Live Media Security Gates', () => {
  it('stores generated image binaries persistently, enforces business/owner isolation, and verifies HMAC signed URLs', async () => {
    const os = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const { PersistentMediaStore } = await import('../server/media/store.ts');
    const { detectImageDimensions } = await import('../server/media/dimensions.ts');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-store-test-'));
    const samplePngPath = path.join(tmpDir, 'sample.png');
    try {
      execFileSync('convert', ['-size', '640x640', 'xc:#6366F1', samplePngPath]);
      const pngBuffer = fs.readFileSync(samplePngPath);
      const dims = await detectImageDimensions(pngBuffer, 'image/png');
      assert.equal(dims.width, 640);
      assert.equal(dims.height, 640);

      const storeIndexPath = path.join(tmpDir, 'media-index.json');
      const store = new PersistentMediaStore({ rootDir: tmpDir, indexPath: storeIndexPath });
      const saved = await store.saveImageBuffer({
        businessId: 'biz_alpha',
        ownerId: 'uid_alpha',
        buffer: pngBuffer,
        mimeType: 'image/png',
        fileName: 'alpha-post.png',
        width: 640,
        height: 640,
        aspectRatio: '1:1',
        prompt: 'پوستر مینیمال محصول',
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite-image',
      });

      assert.ok(saved.signedUrl.includes(`/api/v1/media/file/biz_alpha/${saved.id}`));
      assert.ok(saved.compactPreviewDataUrl?.startsWith('data:image/jpeg;base64,'));
      assert.ok((saved.compactPreviewDataUrl?.length || 0) <= 350000);

      // Parse exp & sig from signedUrl
      const urlObj = new URL(saved.signedUrl, 'http://localhost:3000');
      const exp = urlObj.searchParams.get('exp') || '';
      const sig = urlObj.searchParams.get('sig') || '';
      assert.equal(store.verifySignedUrl('biz_alpha', saved.id, exp, sig), true);

      // Tampering with businessId or sig must fail verification
      assert.equal(store.verifySignedUrl('biz_beta', saved.id, exp, sig), false);
      assert.equal(store.verifySignedUrl('biz_alpha', saved.id, exp, `${sig.slice(0, -4)}0000`), false);

      // Cross-business & cross-owner tenant isolation
      assert.equal(store.listByBusiness('biz_alpha', 'uid_alpha').length, 1);
      assert.equal(store.listByBusiness('biz_alpha', 'uid_intruder').length, 0);
      assert.equal(store.listByBusiness('biz_beta', 'uid_alpha').length, 0);
      assert.equal(await store.readMediaBuffer('biz_alpha', saved.id, 'uid_intruder'), null);

      // Persistence check across new store instance (simulated restart/reload)
      const reloadedStore = new PersistentMediaStore({ rootDir: tmpDir, indexPath: storeIndexPath });
      const reloadedList = reloadedStore.listByBusiness('biz_alpha', 'uid_alpha');
      assert.equal(reloadedList.length, 1);
      assert.equal(reloadedList[0].id, saved.id);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('composes Persian RTL brand overlays at exact 1080x1920, 1080x1080, and 1080x1350 dimensions', async () => {
    const os = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const { composeBrandVisual } = await import('../server/media/composer.ts');
    const { detectImageDimensions } = await import('../server/media/dimensions.ts');

    const tmpPng = path.join(os.tmpdir(), `cmp-src-${Date.now()}.png`);
    try {
      execFileSync('convert', ['-size', '800x800', 'xc:#1E293B', tmpPng]);
      const sourceBuffer = fs.readFileSync(tmpPng);

      const formats: Array<{ format: 'story' | 'square_post' | 'carousel_slide'; w: number; h: number }> = [
        { format: 'story', w: 1080, h: 1920 },
        { format: 'square_post', w: 1080, h: 1080 },
        { format: 'carousel_slide', w: 1080, h: 1350 },
      ];

      for (const f of formats) {
        const result = await composeBrandVisual({
          sourceBuffer,
          sourceMimeType: 'image/png',
          format: f.format,
          brandName: 'استودیو محتوای پارسی',
          headline: 'کاهش ۵۰٪ زمان تولید محتوای برند',
          subheadline: 'طراحی خودکار پست و استوری اینستاگرام',
          ctaText: 'شروع رایگان همین امروز',
          primaryColor: '#6366F1',
          secondaryColor: '#8B5CF6',
        });

        assert.equal(result.width, f.w);
        assert.equal(result.height, f.h);
        const verifiedDims = await detectImageDimensions(result.buffer, result.mimeType);
        assert.equal(verifiedDims.width, f.w);
        assert.equal(verifiedDims.height, f.h);
        assert.ok(result.buffer.length > 5000);
      }
    } finally {
      if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng);
    }
  });

  it('rejects unauthenticated image/media API calls with 401 and tampered signed URLs with 403 on live port 3000', async () => {
    const baseUrl = 'http://localhost:3000';

    const authPostEndpoints = [
      '/api/v1/ai/images/generate',
      '/api/v1/ai/images/edit',
      '/api/v1/ai/images/compose',
      '/api/v1/media/list',
      '/api/v1/media/attach',
      '/api/v1/admin/ai/providers/gemini/test-image',
    ];
    for (const ep of authPostEndpoints) {
      const res = await fetch(`${baseUrl}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 401, `Expected 401 on POST ${ep}`);
    }

    const jobRes = await fetch(`${baseUrl}/api/v1/ai/images/jobs/job_missing?businessId=biz_1`);
    assert.equal(jobRes.status, 401);

    const delRes = await fetch(`${baseUrl}/api/v1/media/biz_1/med_1`, { method: 'DELETE' });
    assert.equal(delRes.status, 401);

    const badSigRes = await fetch(`${baseUrl}/api/v1/media/file/biz_1/med_1?exp=9999999999&sig=tampered_sig`);
    assert.equal(badSigRes.status, 403);
  });
});


