import 'dotenv/config';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Type } from '@google/genai';
import { aiRouter } from './server/ai/router';
import { aiAdminStore } from './server/ai/store';
import { ProviderExecutionError } from './server/ai/adapters/base';
import type { AiCapability, AiModelSpec, AiPlatformCredentialPolicy, AiProviderId, ImageAspectRatio } from './server/ai/types';
import { composeBrandVisual, normalizeImageToTargetDimensions, resolveFormatDimensions, type VisualFormatKey } from './server/media/composer';
import { imageJobManager } from './server/media/jobs';
import { persistentMediaStore } from './server/media/store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseClientConfig {
  projectId: string;
}

function loadFirebaseProjectId(): string {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as FirebaseClientConfig;
  return parsed.projectId;
}

const FIREBASE_PROJECT_ID = loadFirebaseProjectId();
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

interface AuthenticatedRequest extends Request {
  requestId?: string;
  authUser?: {
    uid: string;
    email?: string;
    emailVerified: boolean;
  };
}

// Per-UID rate limiting window (max 25 AI requests per 60s window)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 25;
const userRateBuckets = new Map<string, { count: number; resetAt: number }>();

// Server-side idempotency registry for verified approval execution checks
const executedApprovalKeys = new Map<string, { verifiedAt: string; approvalId: string; payloadHash: string }>();

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      if (record[k] !== undefined) {
        out[k] = canonicalizeValue(record[k]);
      }
    }
    return out;
  }
  return value;
}

function computeCanonicalSha256Hex(payload: unknown): string {
  const canonicalJson = JSON.stringify(canonicalizeValue(payload ?? {}));
  return crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

function checkRateLimit(uid: string): { allowed: boolean; remaining: number; resetInSeconds: number } {
  const now = Date.now();
  const bucket = userRateBuckets.get(uid);
  if (!bucket || now >= bucket.resetAt) {
    userRateBuckets.set(uid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetInSeconds: 60 };
  }
  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - bucket.count,
    resetInSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

async function requireFirebaseAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match) {
      res.status(401).json({ error: 'توکن احراز هویت ارسال نشده است.' });
      return;
    }
    const token = match[1];
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });
    if (!payload.sub) {
      res.status(401).json({ error: 'شناسه کاربر در توکن معتبر نیست.' });
      return;
    }
    if (!payload.email_verified) {
      res.status(403).json({ error: 'ایمیل حساب کاربری تأیید نشده است.' });
      return;
    }
    req.authUser = {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      emailVerified: Boolean(payload.email_verified),
    };

    const rate = checkRateLimit(payload.sub);
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    if (!rate.allowed) {
      res.status(429).json({
        error: `تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً ${rate.resetInSeconds} ثانیه دیگر تلاش کنید.`,
      });
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: 'نشست کاربری معتبر نیست یا منقضی شده است.' });
  }
}

function verifyBusinessOwnership(req: AuthenticatedRequest, res: Response, business: Record<string, unknown> | undefined): boolean {
  if (!req.authUser) {
    res.status(401).json({ error: 'کاربر احراز هویت نشده است.' });
    return false;
  }
  if (!business || typeof business !== 'object') {
    res.status(400).json({ error: 'اطلاعات فضای کاری کسب‌وکار در درخواست ارسال نشده است.' });
    return false;
  }
  const ownerId = typeof business.ownerId === 'string' ? business.ownerId : '';
  if (!ownerId || ownerId !== req.authUser.uid) {
    res.status(403).json({
      error: 'دسترسی غیرمجاز: شما مالک این فضای کاری کسب‌وکار نیستید.',
    });
    return false;
  }
  return true;
}

function validateInputLength(value: unknown, maxChars: number, fieldLabel: string, res: Response): boolean {
  if (typeof value === 'string' && value.length > maxChars) {
    res.status(400).json({
      error: `طول فیلد «${fieldLabel}» بیش از حد مجاز (${maxChars} کاراکتر) است.`,
    });
    return false;
  }
  return true;
}

const SUPER_ADMIN_EMAILS = new Set(
  [
    'baabzanco@gmail.com',
    ...(process.env.SUPER_ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ]
);

function isSuperAdminUser(authUser?: AuthenticatedRequest['authUser']): boolean {
  if (!authUser || !authUser.emailVerified || !authUser.email) return false;
  return SUPER_ADMIN_EMAILS.has(authUser.email.toLowerCase());
}

function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.authUser) {
    res.status(401).json({ error: 'کاربر احراز هویت نشده است.' });
    return;
  }
  if (!isSuperAdminUser(req.authUser)) {
    res.status(403).json({
      error: 'دسترسی غیرمجاز: این بخش منحصراً برای مدیر کل پلتفرم (Super Admin) است.',
    });
    return;
  }
  next();
}

const VALID_PROVIDER_IDS: AiProviderId[] = ['gemini', 'openai', 'fal', 'replicate'];
function parseProviderId(raw: string): AiProviderId | null {
  return VALID_PROVIDER_IDS.includes(raw as AiProviderId) ? (raw as AiProviderId) : null;
}

const GEMINI_MODEL = 'gemini-4-hydrogen';
const GEMINI_MODEL_CASCADE = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'] as const;

async function generateStructuredJson(params: {
  requestId: string;
  businessId: string;
  ownerId: string;
  contents: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  preferredModelId?: string;
}): Promise<{
  parsed: Record<string, unknown>;
  tokens: { input: number; output: number; estimatedCostUsd: number };
  modelUsed: string;
  providerId: AiProviderId;
  fallbackUsed: boolean;
}> {
  const result = await aiRouter.generateStructuredJson(
    {
      requestId: params.requestId,
      businessId: params.businessId,
      ownerId: params.ownerId,
      preferredModelId: params.preferredModelId,
    },
    {
      contents: params.contents,
      systemInstruction: params.systemInstruction,
      responseSchema: params.responseSchema,
    }
  );
  return {
    parsed: result.parsed,
    tokens: {
      input: result.inputTokens,
      output: result.outputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    },
    modelUsed: result.modelUsed,
    providerId: result.providerId,
    fallbackUsed: result.fallbackUsed,
  };
}

function formatActionableImageError(err: unknown): { status: number; code: string; error: string } {
  const status =
    err instanceof ProviderExecutionError
      ? err.status
      : typeof (err as { status?: number })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
  const code = err instanceof ProviderExecutionError ? err.code : '';
  const msg = err instanceof Error ? err.message : String(err);

  if (code === 'IMAGE_GENERATION_NOT_CONFIGURED' || code === 'NO_ELIGIBLE_PROVIDER') {
    return {
      status: 503,
      code: 'IMAGE_GENERATION_NOT_CONFIGURED',
      error:
        'تولید تصویر پیکربندی نشده است: هیچ سرویس‌دهنده و مدل فعال تولید تصویر با کلید API معتبر در سیستم ثبت نشده است.',
    };
  }
  if (code === 'CUSTOMER_CREDENTIAL_MISSING') {
    return {
      status: 400,
      code,
      error:
        'کلید API اختصاصی کسب‌وکار برای قابلیت تولید تصویر ثبت نشده است. لطفاً در تنظیمات هوش مصنوعی کسب‌وکار کلید معتبر وارد کنید.',
    };
  }
  if (code === 'PAID_KEY_OR_AUTH_REQUIRED' || status === 401 || status === 403) {
    return {
      status: status === 401 ? 401 : 403,
      code: 'PAID_KEY_OR_AUTH_REQUIRED',
      error:
        'کلید API فعلی مجوز دسترسی به مدل انتخاب‌شده تولید تصویر را ندارد (ممکن است نیازمند کلید دارای پرداخت فعال یا کلید سرویس‌دهنده دیگر باشد).',
    };
  }
  if (status === 429 || code === 'QUOTA_EXCEEDED' || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return {
      status: 429,
      code: 'QUOTA_EXCEEDED',
      error: 'سهمیه تولید تصویر در سرویس‌دهنده انتخاب‌شده موقتاً تکمیل شده است. لطفاً چند لحظه بعد یا با سرویس‌دهنده دیگر تلاش کنید.',
    };
  }
  if (status === 503 || code === 'MODEL_OVERLOADED' || msg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      code: 'MODEL_OVERLOADED',
      error: 'سرویس تولید تصویر موقتاً شلوغ است. لطفاً روی «تلاش مجدد» کلیک کنید.',
    };
  }
  if (code === 'INVALID_IMAGE_REQUEST' || status === 400) {
    return {
      status: 400,
      code: code || 'INVALID_IMAGE_REQUEST',
      error: `پارامترهای درخواست تولید تصویر معتبر نیستند: ${msg.slice(0, 180)}`,
    };
  }
  if (code === 'EMPTY_IMAGE_RESPONSE') {
    return {
      status: 502,
      code,
      error: msg,
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: code || 'IMAGE_GENERATION_FAILED',
    error: `خطا در تولید تصویر: ${msg.slice(0, 200)}`,
  };
}

function sendGeminiErrorResponse(res: Response, err: unknown, defaultFaMessage: string) {
  const status =
    err instanceof ProviderExecutionError
      ? err.status
      : typeof (err as { status?: number })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
  const code = err instanceof ProviderExecutionError ? err.code : '';
  const msg = err instanceof Error ? err.message : String(err);
  console.error('AI endpoint error:', { status, code, message: msg.slice(0, 300) });

  if (code === 'IMAGE_GENERATION_NOT_CONFIGURED' || code === 'PAID_KEY_OR_AUTH_REQUIRED') {
    const mapped = formatActionableImageError(err);
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    return;
  }
  if (code === 'CUSTOMER_CREDENTIAL_MISSING') {
    res.status(400).json({
      error: 'کلید API اختصاصی کسب‌وکار برای این قابلیت ثبت نشده است. لطفاً در تنظیمات هوش مصنوعی کسب‌وکار کلید خود را وارد کنید.',
      code,
    });
    return;
  }
  if (code === 'NO_ELIGIBLE_PROVIDER' || msg === 'GEMINI_API_KEY_MISSING') {
    res.status(503).json({
      error: 'هیچ سرویس‌دهنده هوش مصنوعی فعالی با کلید معتبر برای این قابلیت پیکربندی نشده است.',
      code: code || 'NO_ELIGIBLE_PROVIDER',
    });
    return;
  }
  if (status === 503 || code === 'MODEL_OVERLOADED' || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
    res.status(503).json({
      error: 'سرویس هوش مصنوعی در حال حاضر با ترافیک بالا روبه‌رو است. لطفاً چند ثانیه دیگر دوباره تلاش کنید.',
      code: 'MODEL_OVERLOADED',
    });
    return;
  }
  if (status === 429 || code === 'QUOTA_EXCEEDED' || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    res.status(429).json({
      error: 'سهمیه درخواست‌های سرویس هوش مصنوعی موقتاً تکمیل شده است. لطفاً کمی بعد تلاش کنید.',
      code: 'QUOTA_EXCEEDED',
    });
    return;
  }
  res.status(500).json({ error: defaultFaMessage, code: 'AI_GENERATION_FAILED' });
}

function formatBusinessContext(business: Record<string, unknown> | undefined): string {
  if (!business) return 'اطلاعات کسب‌وکار ثبت نشده است.';
  const brand = (business.brandSettings as Record<string, unknown> | undefined) ?? {};
  const audience = (business.audienceProfile as Record<string, unknown> | undefined) ?? {};
  const goals = (business.businessGoals as Record<string, unknown> | undefined) ?? {};
  return [
    `نام کسب‌وکار: ${String(business.name ?? '').slice(0, 200)}`,
    `نام سازنده: ${String(business.creatorName ?? '').slice(0, 150)}`,
    `حوزه فعالیت (نیچ): ${String(business.niche ?? business.category ?? '').slice(0, 200)}`,
    `توضیحات: ${String(business.description ?? '').slice(0, 1000)}`,
    `زبان اصلی: ${String(business.primaryLanguage ?? 'fa')}`,
    `واحد پول: ${String(business.currency ?? 'IRT')}`,
    `لحن برند: ${String(brand.voice ?? '').slice(0, 200)} | سبک ارتباطی: ${String(brand.communicationStyle ?? '').slice(0, 200)}`,
    `واژگان ممنوعه برند: ${String(brand.avoidWords ?? 'ندارد').slice(0, 300)}`,
    `مخاطبان هدف: ${String(audience.description ?? '').slice(0, 500)} | دغدغه‌ها: ${String(audience.painPoints ?? '').slice(0, 500)}`,
    `اهداف: ${String(goals.primaryObjective ?? '').slice(0, 300)} | هدف رشد: ${String(goals.audienceGoal ?? '').slice(0, 300)}`,
  ].join('\n');
}

const PERSIAN_WRITING_RULES = `
الزامات نگارش و رفتار هوش مصنوعی:
1. زبان پیش‌فرض پاسخ‌ها و خروجی‌ها فارسی استاندارد، روان و حرفه‌ای است (مگر کاربر صراحتاً زبان دیگری بخواهد).
2. رعایت دقیق نیم‌فاصله در واژگان فارسی (مانند: «می‌شود»، «برنامه‌ریزی»، «تولیدکنندگان»، «کسب‌وکار»، «هوش مصنوعی») و علائم نگارشی صحیح.
3. هرگز آمار واقعی جعلی (تعداد فالوور، ایمپرشن، درآمد یا نرخ تعامل ساختگی) تولید نکن؛ اگر داده‌ای متصل نیست، صراحتاً بنویس «داده واقعی در دسترس نیست».
4. میان «داده‌های تأییدشده کسب‌وکار» و «پیشنهادها/فرض‌های هوش مصنوعی» تمایز شفاف قائل شو.
5. هیچ اقدام خارجی (انتشار پست، ارسال پیام، تغییر قیمت، ایمیل تبلیغاتی) را انجام‌شده اعلام نکن؛ تمام اقدامات خارجی نیازمند تأیید صریح مالک هستند.
`;

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '6mb' }));

  // Security headers & structured request logging middleware (never logs secrets or raw tokens)
  app.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const requestId = crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    const startTime = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) {
        const durationMs = Date.now() - startTime;
        const bizId =
          typeof req.body?.business?.id === 'string'
            ? req.body.business.id
            : typeof req.body?.businessId === 'string'
            ? req.body.businessId
            : undefined;
        console.info(
          JSON.stringify({
            level: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO',
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs,
            uid: req.authUser?.uid ?? 'anonymous',
            businessId: bizId ?? null,
          })
        );
      }
    });
    next();
  });

  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      model: GEMINI_MODEL,
      fallbackModels: GEMINI_MODEL_CASCADE,
      providersCount: aiAdminStore.getProviders(aiRouter.getCircuitBreakers()).length,
    });
  });

  app.get('/api/v1/auth/me', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({
      uid: req.authUser!.uid,
      email: req.authUser!.email || null,
      emailVerified: req.authUser!.emailVerified,
      isSuperAdmin: isSuperAdminUser(req.authUser),
    });
  });

  // ===========================================================================
  // Super Admin AI Provider Management Endpoints
  // ===========================================================================
  app.get('/api/v1/admin/ai/overview', requireFirebaseAuth, requireSuperAdmin, (_req: AuthenticatedRequest, res: Response) => {
    res.json({
      providers: aiAdminStore.getProviders(aiRouter.getCircuitBreakers()),
      models: aiAdminStore.getModels(),
      policy: aiAdminStore.getPolicy(),
      telemetry: aiAdminStore.getTelemetrySummary(),
      recentLogs: aiAdminStore.getRequestLogs({ limit: 80 }),
    });
  });

  app.post('/api/v1/admin/ai/providers', requireFirebaseAuth, requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id, name, enabled, priority, timeoutMs, maxRetries, fallbackEnabled, baseUrl } = req.body as {
        id?: string;
        name?: string;
        enabled?: boolean;
        priority?: number;
        timeoutMs?: number;
        maxRetries?: number;
        fallbackEnabled?: boolean;
        baseUrl?: string;
      };
      const providerId = id ? parseProviderId(id) : null;
      if (!providerId) {
        res.status(400).json({ error: 'شناسه سرویس‌دهنده معتبر نیست.' });
        return;
      }
      const updated = aiAdminStore.upsertProvider(providerId, {
        name,
        enabled,
        priority,
        timeoutMs,
        maxRetries,
        fallbackEnabled,
        baseUrl,
      });
      res.json({ provider: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'خطا در به‌روزرسانی سرویس‌دهنده' });
    }
  });

  app.post(
    '/api/v1/admin/ai/providers/:providerId/credentials',
    requireFirebaseAuth,
    requireSuperAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const providerId = parseProviderId(req.params.providerId);
        if (!providerId) {
          res.status(400).json({ error: 'شناسه سرویس‌دهنده معتبر نیست.' });
          return;
        }
        const { apiKey } = req.body as { apiKey?: string };
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
          res.status(400).json({ error: 'کلید API باید حداقل ۸ کاراکتر معتبر داشته باشد.' });
          return;
        }
        const provider = aiAdminStore.setPlatformCredential(providerId, apiKey);
        res.json({ provider, message: 'کلید با رمزنگاری AES-256-GCM ذخیره شد.' });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'خطا در ذخیره کلید API' });
      }
    }
  );

  app.delete(
    '/api/v1/admin/ai/providers/:providerId/credentials',
    requireFirebaseAuth,
    requireSuperAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      const providerId = parseProviderId(req.params.providerId);
      if (!providerId) {
        res.status(400).json({ error: 'شناسه سرویس‌دهنده معتبر نیست.' });
        return;
      }
      const provider = aiAdminStore.deletePlatformCredential(providerId);
      res.json({ provider, message: 'کلید ذخیره‌شده پلتفرم حذف شد.' });
    }
  );

  app.post(
    '/api/v1/admin/ai/providers/:providerId/test',
    requireFirebaseAuth,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const providerId = parseProviderId(req.params.providerId);
        if (!providerId) {
          res.status(400).json({ error: 'شناسه سرویس‌دهنده معتبر نیست.' });
          return;
        }
        const result = await aiRouter.testProviderConnection(providerId);
        res.json({
          result,
          provider: aiAdminStore.getProviders(aiRouter.getCircuitBreakers()).find((p) => p.id === providerId),
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در تست اتصال سرویس‌دهنده' });
      }
    }
  );

  app.post(
    '/api/v1/admin/ai/providers/:providerId/test-image',
    requireFirebaseAuth,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const providerId = parseProviderId(req.params.providerId);
        if (!providerId) {
          res.status(400).json({ error: 'شناسه سرویس‌دهنده معتبر نیست.' });
          return;
        }
        const { modelId } = (req.body ?? {}) as { modelId?: string };
        const result = await aiRouter.testProviderImageGeneration(providerId, req.authUser!.uid, modelId);
        res.json({
          result,
          provider: aiAdminStore.getProviders(aiRouter.getCircuitBreakers()).find((p) => p.id === providerId),
        });
      } catch (err) {
        const mapped = formatActionableImageError(err);
        res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
      }
    }
  );

  app.post('/api/v1/admin/ai/models', requireFirebaseAuth, requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body as Partial<AiModelSpec>;
      const providerId = body.providerId ? parseProviderId(body.providerId) : null;
      if (!providerId || !body.modelId || typeof body.modelId !== 'string') {
        res.status(400).json({ error: 'سرویس‌دهنده و شناسه مدل الزامی است.' });
        return;
      }
      const existing = aiAdminStore.getModels().find((m) => m.id === (body.id || `${providerId}:${body.modelId}`));
      const spec: AiModelSpec = {
        id: body.id || `${providerId}:${body.modelId.trim()}`,
        providerId,
        modelId: body.modelId.trim(),
        displayName: (body.displayName || existing?.displayName || body.modelId).trim(),
        capabilities:
          Array.isArray(body.capabilities) && body.capabilities.length > 0
            ? (body.capabilities as AiCapability[])
            : existing?.capabilities ?? ['text_generation'],
        inputFormats: Array.isArray(body.inputFormats) ? body.inputFormats : existing?.inputFormats ?? ['text/plain'],
        outputFormats: Array.isArray(body.outputFormats) ? body.outputFormats : existing?.outputFormats ?? ['text/plain'],
        maxInputSize: body.maxInputSize || existing?.maxInputSize || '128K tokens',
        maxOutputDurationSec:
          body.maxOutputDurationSec !== undefined ? body.maxOutputDurationSec : existing?.maxOutputDurationSec ?? null,
        pricingMetadata: body.pricingMetadata ?? existing?.pricingMetadata ?? { unit: '1m_tokens', inputCostUsd: 0.1, outputCostUsd: 0.3 },
        availabilityStatus: body.availabilityStatus ?? existing?.availabilityStatus ?? 'available',
        isDefaultForCapabilities: Array.isArray(body.isDefaultForCapabilities)
          ? (body.isDefaultForCapabilities as AiCapability[])
          : existing?.isDefaultForCapabilities ?? [],
        fallbackEligible:
          typeof body.fallbackEligible === 'boolean' ? body.fallbackEligible : existing?.fallbackEligible ?? true,
        priority: typeof body.priority === 'number' ? body.priority : existing?.priority ?? 20,
        requiresPaidKey: typeof body.requiresPaidKey === 'boolean' ? body.requiresPaidKey : existing?.requiresPaidKey,
        supportedAspectRatios: body.supportedAspectRatios ?? existing?.supportedAspectRatios,
        resolutionOptions: body.resolutionOptions ?? existing?.resolutionOptions,
        supportsNegativePrompt: body.supportsNegativePrompt ?? existing?.supportsNegativePrompt,
        supportsReferenceImage: body.supportsReferenceImage ?? existing?.supportsReferenceImage,
        supportsVariation: body.supportsVariation ?? existing?.supportsVariation,
        timeoutMs: body.timeoutMs ?? existing?.timeoutMs,
      };

      const saved = aiAdminStore.upsertModel(spec);
      res.json({ model: saved, models: aiAdminStore.getModels() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'خطا در ذخیره مدل' });
    }
  });

  app.post('/api/v1/admin/ai/policy', requireFirebaseAuth, requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const { credentialPolicy, allowBusinessFallbackToPlatform, defaultCooldownMs } = req.body as {
      credentialPolicy?: AiPlatformCredentialPolicy;
      allowBusinessFallbackToPlatform?: boolean;
      defaultCooldownMs?: number;
    };
    const policy = aiAdminStore.updatePolicy({
      credentialPolicy,
      allowBusinessFallbackToPlatform,
      defaultCooldownMs,
    });
    res.json({ policy });
  });

  // ===========================================================================
  // Business Owner AI Credential & Usage Settings (Strictly Tenant-Isolated)
  // ===========================================================================
  app.post('/api/v1/business/ai-settings/get', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = req.body?.business as Record<string, unknown> | undefined;
    if (!verifyBusinessOwnership(req, res, business)) return;
    const bizId = String(business!.id);
    res.json({
      settings: aiAdminStore.getPublicBusinessSettings(bizId),
      telemetry: aiAdminStore.getTelemetrySummary(bizId),
      recentLogs: aiAdminStore.getRequestLogs({ businessId: bizId, limit: 25 }),
      availableModels: aiAdminStore
        .getModels()
        .filter((m) => m.availabilityStatus !== 'disabled')
        .map((m) => ({
          id: m.id,
          providerId: m.providerId,
          modelId: m.modelId,
          displayName: m.displayName,
          capabilities: m.capabilities,
          supportedAspectRatios: m.supportedAspectRatios,
          resolutionOptions: m.resolutionOptions,
          supportsNegativePrompt: m.supportsNegativePrompt,
          supportsReferenceImage: m.supportsReferenceImage,
          supportsVariation: m.supportsVariation,
        })),
    });
  });

  app.post('/api/v1/business/ai-settings/update', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { business, credentialMode, preferredProviders, preferredModels, setCustomerKey, removeCustomerKeyProvider } =
        req.body as {
          business?: Record<string, unknown>;
          credentialMode?: 'platform' | 'customer';
          preferredProviders?: Partial<Record<AiCapability, AiProviderId>>;
          preferredModels?: Partial<Record<AiCapability, string>>;
          setCustomerKey?: { providerId: string; apiKey: string };
          removeCustomerKeyProvider?: string;
        };

      if (!verifyBusinessOwnership(req, res, business)) return;
      const bizId = String(business!.id);

      let parsedSetKey: { providerId: AiProviderId; apiKey: string } | undefined;
      if (setCustomerKey) {
        const pid = parseProviderId(setCustomerKey.providerId);
        if (!pid || !setCustomerKey.apiKey || setCustomerKey.apiKey.trim().length < 8) {
          res.status(400).json({ error: 'کلید API اختصاصی معتبر نیست (حداقل ۸ کاراکتر).' });
          return;
        }
        parsedSetKey = { providerId: pid, apiKey: setCustomerKey.apiKey };
      }

      const removePid = removeCustomerKeyProvider ? parseProviderId(removeCustomerKeyProvider) ?? undefined : undefined;

      const updated = aiAdminStore.updateBusinessSettings({
        businessId: bizId,
        ownerId: req.authUser!.uid,
        credentialMode,
        preferredProviders,
        preferredModels,
        setCustomerKey: parsedSetKey,
        removeCustomerKeyProvider: removePid,
      });

      res.json({ settings: updated });
    } catch (err) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات هوش مصنوعی کسب‌وکار' });
    }
  });

  app.post('/api/v1/business/ai-settings/test-key', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { business, providerId: rawProviderId, apiKey } = req.body as {
        business?: Record<string, unknown>;
        providerId?: string;
        apiKey?: string;
      };
      if (!verifyBusinessOwnership(req, res, business)) return;
      const providerId = rawProviderId ? parseProviderId(rawProviderId) : null;
      if (!providerId) {
        res.status(400).json({ error: 'سرویس‌دهنده معتبر نیست.' });
        return;
      }
      const keyToTest =
        apiKey?.trim() || aiAdminStore.resolveCustomerKey(String(business!.id), req.authUser!.uid, providerId) || '';
      const result = await aiRouter.testProviderConnection(providerId, keyToTest);
      res.json({ result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در تست کلید اختصاصی' });
    }
  });

  // Cryptographic Approval & Integration Gate Verification Endpoint (Tests D, E, F, G)
  app.post('/api/v1/approvals/verify-execution', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const {
      business,
      approvalId,
      approvalStatus,
      expectedPayloadHash,
      currentPayload,
      idempotencyKey,
      integrationConnected,
      targetPlatform,
    } = req.body as {
      business?: Record<string, unknown>;
      approvalId?: string;
      approvalStatus?: string;
      expectedPayloadHash?: string;
      currentPayload?: unknown;
      idempotencyKey?: string;
      integrationConnected?: boolean;
      targetPlatform?: string;
    };

    if (!verifyBusinessOwnership(req, res, business)) return;

    if (!approvalId || !expectedPayloadHash || !idempotencyKey) {
      res.status(400).json({ error: 'پارامترهای بررسی یکپارچگی تأیید ناقص است.' });
      return;
    }

    if (approvalStatus !== 'approved') {
      res.status(403).json({
        verified: false,
        canExecuteExternally: false,
        status: 'unapproved',
        error: 'این اقدام هنوز توسط مالک کسب‌وکار تأیید نهایی نشده است.',
      });
      return;
    }

    const computedHash = computeCanonicalSha256Hex(currentPayload ?? {});
    if (computedHash !== expectedPayloadHash) {
      res.status(409).json({
        verified: false,
        canExecuteExternally: false,
        status: 'hash_mismatch',
        computedHash,
        expectedPayloadHash,
        error: 'خطای امنیتی: محتوای اقدام پس از ثبت درخواست تغییر کرده و امضای SHA-256 نامعتبر است. نیازمند ثبت تأیید جدید.',
      });
      return;
    }

    const scopedIdempotencyKey = `${req.authUser!.uid}:${String(business?.id)}:${idempotencyKey}`;
    const existingExecution = executedApprovalKeys.get(scopedIdempotencyKey);
    if (existingExecution) {
      res.status(409).json({
        verified: false,
        canExecuteExternally: false,
        status: 'duplicate_execution_blocked',
        verifiedAt: existingExecution.verifiedAt,
        error: 'این درخواست قبلاً بررسی و قفل شده است (جلوگیری از اجرای تکراری / Idempotency).',
      });
      return;
    }

    if (!integrationConnected) {
      res.json({
        verified: true,
        hashValid: true,
        computedHash,
        canExecuteExternally: false,
        status: 'blocked_disconnected',
        message: `امضای دیجیتال SHA-256 معتبر است، اما اتصال خارجی (${targetPlatform || 'سرویس مقصد'}) برقرار نیست. هیچ انتشار یا ارسال خارجی شبیه‌سازی نشد.`,
      });
      return;
    }

    const verifiedAt = new Date().toISOString();
    executedApprovalKeys.set(scopedIdempotencyKey, {
      verifiedAt,
      approvalId,
      payloadHash: computedHash,
    });

    res.json({
      verified: true,
      hashValid: true,
      computedHash,
      canExecuteExternally: true,
      status: 'ready_for_connector',
      verifiedAt,
      message: 'امضای SHA-256، تأیید مالک و کلید یکتای اجرا (Idempotency) تأیید شد.',
    });
  });

  // 1. Onboarding Strategic Summary
  app.post('/api/v1/ai/onboarding-summary', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const business = req.body?.business as Record<string, unknown> | undefined;
      if (!verifyBusinessOwnership(req, res, business)) return;

      const context = formatBusinessContext(business);
      const { parsed, tokens, modelUsed } = await generateStructuredJson({
        requestId: req.requestId || crypto.randomUUID(),
        businessId: String(business!.id),
        ownerId: req.authUser!.uid,
        contents: `بر اساس اطلاعات ثبت‌شده زیر، یک خلاصه استراتژیک روشن برای پروفایل کسب‌وکار این تولیدکننده محتوا بنویس، فرصت‌های کلیدی را مشخص کن و برنامه عملیاتی هفته اول را پیشنهاد بده.\n\n${context}`,
        systemInstruction: `تو مدیر ارشد هوش مصنوعی در پلتفرم MicroBusiness Autopilot هستی.\n${PERSIAN_WRITING_RULES}`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: 'خلاصه جامع و دقیق پروفایل کسب‌وکار به فارسی' },
            keyOpportunities: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '۳ تا ۵ فرصت کلیدی رشد بر اساس اطلاعات ورودی',
            },
            recommendedFirstWeekPlan: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '۴ اقدام پیشنهادی برای هفته اول',
            },
          },
          required: ['summary', 'keyOpportunities', 'recommendedFirstWeekPlan'],
        },
      });

      res.json({
        summary: (parsed.summary as string) || '',
        keyOpportunities: Array.isArray(parsed.keyOpportunities) ? parsed.keyOpportunities : [],
        recommendedFirstWeekPlan: Array.isArray(parsed.recommendedFirstWeekPlan) ? parsed.recommendedFirstWeekPlan : [],
        tokensUsed: tokens.input + tokens.output,
        estimatedCostUsd: tokens.estimatedCostUsd,
        modelUsed,
      });
    } catch (err) {
      sendGeminiErrorResponse(res, err, 'خطا در تولید خلاصه استراتژیک کسب‌وکار. لطفاً دوباره تلاش کنید.');
    }
  });

  // 2. Chief AI Manager Chat
  app.post('/api/v1/ai/manager/chat', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { message, business, metricsSnapshot, memoryItems, recentTasks } = req.body as {
        message: string;
        business?: Record<string, unknown>;
        metricsSnapshot?: Record<string, unknown>;
        memoryItems?: Array<{ title: string; content: string; verifiedByOwner: boolean }>;
        recentTasks?: Array<{ title: string; status: string; agentType?: string }>;
      };

      if (!verifyBusinessOwnership(req, res, business)) return;
      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'متن پیام به مدیر هوشمند نمی‌تواند خالی باشد.' });
        return;
      }
      if (!validateInputLength(message, 8000, 'پیام کاربر', res)) return;

      const memoryText = (memoryItems ?? [])
        .slice(0, 12)
        .map((m) => `- [${m.verifiedByOwner ? 'تأییدشده' : 'پیشنهاد AI'}] ${String(m.title).slice(0, 120)}: ${String(m.content).slice(0, 400)}`)
        .join('\n');

      const tasksText = (recentTasks ?? [])
        .slice(0, 8)
        .map((t) => `- ${String(t.title).slice(0, 140)} (${String(t.status)})`)
        .join('\n');

      const prompt = [
        `درخواست کاربر: ${message.trim()}`,
        `\nپروفایل کسب‌وکار:\n${formatBusinessContext(business)}`,
        `\nآمار واقعی سیستم:\n${JSON.stringify(metricsSnapshot ?? {}, null, 2)}`,
        memoryText ? `\nحافظه کسب‌وکار:\n${memoryText}` : '',
        tasksText ? `\nآخرین وظایف:\n${tasksText}` : '',
      ].join('\n');

      const { parsed, tokens, modelUsed } = await generateStructuredJson({
        requestId: req.requestId || crypto.randomUUID(),
        businessId: String(business!.id),
        ownerId: req.authUser!.uid,
        contents: prompt,
        systemInstruction: `تو «مدیر ارشد هوش مصنوعی» هستی. درخواست کاربر را تحلیل کن، با تکیه بر داده‌های واقعی پاسخ بده، مشخص کن کدام بخش مبتنی بر داده واقعی و کدام بخش پیشنهاد تحلیلی است، و مناسب‌ترین ایجنت تخصصی را برای ادامه کار پیشنهاد کن.\n${PERSIAN_WRITING_RULES}`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING, description: 'پاسخ کامل، کاربردی و شفاف به فارسی' },
            factsUsed: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'داده‌های واقعی استفاده‌شده از پروفایل و آمار سیستم',
            },
            assumptionsAndRecommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'فرض‌ها یا پیشنهادهای استراتژیک AI',
            },
            suggestedTaskTitle: { type: Type.STRING, description: 'عنوان یک وظیفه پیشنهادی کوتاه برای پیگیری' },
            recommendedAgentType: {
              type: Type.STRING,
              description: 'یکی از: chief_manager, content, research_growth, sales_monetization, customer_relationship',
            },
            requiresApproval: {
              type: Type.BOOLEAN,
              description: 'آیا اجرای نهایی این موضوع نیازمند تأیید انسانی در مرکز تأییدها است؟',
            },
          },
          required: [
            'reply',
            'factsUsed',
            'assumptionsAndRecommendations',
            'suggestedTaskTitle',
            'recommendedAgentType',
            'requiresApproval',
          ],
        },
      });

      const validAgents = ['chief_manager', 'content', 'research_growth', 'sales_monetization', 'customer_relationship'];
      const recommendedAgentType = validAgents.includes(String(parsed.recommendedAgentType))
        ? parsed.recommendedAgentType
        : 'chief_manager';

      res.json({
        reply: (parsed.reply as string) || '',
        factsUsed: Array.isArray(parsed.factsUsed) ? parsed.factsUsed : [],
        assumptionsAndRecommendations: Array.isArray(parsed.assumptionsAndRecommendations)
          ? parsed.assumptionsAndRecommendations
          : [],
        suggestedTaskTitle: (parsed.suggestedTaskTitle as string) || 'پیگیری درخواست مدیر هوشمند',
        recommendedAgentType,
        requiresApproval: Boolean(parsed.requiresApproval),
        tokens,
        modelUsed,
      });
    } catch (err) {
      sendGeminiErrorResponse(res, err, 'خطا در ارتباط با مدیر هوشمند. لطفاً دوباره تلاش کنید.');
    }
  });

  // 3. Execute Specialist Agent Task
  app.post('/api/v1/ai/agents/execute', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { agentType, agentName, prompt, preferredTone, outputLanguage, business, contextSnapshot } = req.body as {
        agentType: string;
        agentName: string;
        prompt: string;
        preferredTone?: string;
        outputLanguage?: string;
        business?: Record<string, unknown>;
        contextSnapshot?: Record<string, unknown>;
      };

      if (!verifyBusinessOwnership(req, res, business)) return;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        res.status(400).json({ error: 'شرح وظیفه ایجنت نمی‌تواند خالی باشد.' });
        return;
      }
      if (!validateInputLength(prompt, 10000, 'شرح وظیفه', res)) return;

      const roleInstructions: Record<string, string> = {
        chief_manager: 'هماهنگ‌کننده استراتژیک: برنامه اقدام مرحله‌ای، اولویت‌بندی و تفکیک وظایف ارائه بده.',
        content: 'متخصص تولید محتوا: ایده‌ها، قلاب‌های جذاب، کپشن و ساختار محتوا با لحن برند و نیم‌فاصله دقیق بنویس.',
        research_growth: 'تحلیل‌گر تحقیق و رشد: فرصت‌های محتوایی و آزمایش‌های رشد را با ذکر محدودیت‌های داده ارائه بده. آمار بیرونی جعلی نساز.',
        sales_monetization: 'متخصص فروش و درآمدزایی: استراتژی تبدیل مخاطب، پیشنهاد محصول و متن معرفی بنویس. تاکید کن ارسال پیام نیازمند تأیید است.',
        customer_relationship: 'متخصص CRM و ارتباط با مشتری: دسته‌بندی نیاز مخاطب و پیش‌نویس پاسخ محترمانه تهیه کن. هرگز پیام را ارسال‌شده فرض نکن.',
      };

      const fullPrompt = [
        `نام ایجنت: ${String(agentName ?? '').slice(0, 100)} (${String(agentType ?? '')})`,
        `زبان خروجی درخواستی: ${outputLanguage === 'en' ? 'انگلیسی' : outputLanguage === 'bilingual' ? 'دوزبانه فارسی و انگلیسی' : 'فارسی استاندارد'}`,
        preferredTone ? `لحن ترجیحی: ${String(preferredTone).slice(0, 150)}` : '',
        `درخواست مالک کسب‌وکار: ${prompt.trim()}`,
        `\nاطلاعات کسب‌وکار:\n${formatBusinessContext(business)}`,
        `\nداده‌های فعلی کسب‌وکار:\n${JSON.stringify(contextSnapshot ?? {}, null, 2)}`,
      ].join('\n');

      const { parsed, tokens, modelUsed } = await generateStructuredJson({
        requestId: req.requestId || crypto.randomUUID(),
        businessId: String(business!.id),
        ownerId: req.authUser!.uid,
        contents: fullPrompt,
        systemInstruction: `${roleInstructions[agentType] || roleInstructions.chief_manager}\n${PERSIAN_WRITING_RULES}`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: 'خروجی اصلی و جمع‌بندی وظیفه' },
            deliverables: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['title', 'detail'],
              },
              description: 'بخش‌های ساختاریافته نتیجه کار',
            },
            requiresApproval: {
              type: Type.BOOLEAN,
              description: 'اگر خروجی شامل اقدام خارجی یا انتشار/ارسال پیام است true برگردان',
            },
            approvalCategory: { type: Type.STRING, description: 'نوع اقدام درخواستی در صورت نیاز به تأیید' },
            approvalReason: { type: Type.STRING, description: 'دلیل نیاز به تأیید مالک' },
            dataLimitations: { type: Type.STRING, description: 'محدودیت‌های داده یا مواردی که منبع بیرونی متصل نیست' },
          },
          required: ['summary', 'deliverables', 'requiresApproval', 'dataLimitations'],
        },
      });

      res.json({
        summary: (parsed.summary as string) || '',
        deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : [],
        requiresApproval: Boolean(parsed.requiresApproval),
        approvalCategory: parsed.approvalCategory,
        approvalReason: parsed.approvalReason,
        dataLimitations: (parsed.dataLimitations as string) || '',
        tokens,
        modelUsed,
      });
    } catch (err) {
      sendGeminiErrorResponse(res, err, 'خطا در اجرای وظیفه ایجنت. لطفاً دوباره تلاش کنید.');
    }
  });

  // 4. Content Studio Generator
  app.post('/api/v1/ai/content/generate', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mode, promptInput, platform, contentType, objective, tone, language, business } = req.body as {
        mode: string;
        promptInput: string;
        platform: string;
        contentType: string;
        objective: string;
        tone: string;
        language: string;
        business?: Record<string, unknown>;
      };

      if (!verifyBusinessOwnership(req, res, business)) return;
      if (!promptInput || typeof promptInput !== 'string' || !promptInput.trim()) {
        res.status(400).json({ error: 'موضوع یا ورودی تولید محتوا نمی‌تواند خالی باشد.' });
        return;
      }
      if (!validateInputLength(promptInput, 10000, 'ورودی تولید محتوا', res)) return;

      const targetLangLabel = language === 'en' ? 'انگلیسی حرفه‌ای' : language === 'ar' ? 'عربی استاندارد' : 'فارسی معیار و خوانا با نیم‌فاصله دقیق';

      const prompt = [
        `حالت تولید: ${String(mode ?? 'topic')}`,
        `پلتفرم مقصد: ${String(platform ?? 'instagram')}`,
        `فرمت محتوا: ${String(contentType ?? 'post')}`,
        `هدف محتوا: ${String(objective || 'آموزش و تعامل مخاطب').slice(0, 300)}`,
        `لحن: ${String(tone || 'مطابق لحن برند').slice(0, 200)}`,
        `زبان خروجی: ${targetLangLabel}`,
        `ورودی/موضوع کاربر: ${promptInput.trim()}`,
        `\nزمینه برند و مخاطبان:\n${formatBusinessContext(business)}`,
      ].join('\n');

      const { parsed, tokens, modelUsed } = await generateStructuredJson({
        requestId: req.requestId || crypto.randomUUID(),
        businessId: String(business!.id),
        ownerId: req.authUser!.uid,
        contents: prompt,
        systemInstruction: `تو ایجنت متخصص تولید محتوای شبکه‌های اجتماعی هستی. محتوای تولیدی باید دقیقاً متناسب با فرمت پلتفرم انتخاب‌شده، دارای قلاب قوی، دعوت به اقدام (CTA) روشن و هشتگ‌های مرتبط باشد.\n${PERSIAN_WRITING_RULES}`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'عنوان کوتاه و گویا برای مدیریت محتوا' },
            caption: { type: Type.STRING, description: 'متن کامل کپشن یا پست' },
            script: { type: Type.STRING, description: 'سناریوی ویدیو یا متن اسلایدهای کاروسل (در صورت نیاز)' },
            cta: { type: Type.STRING, description: 'فراخوان به اقدام (Call to Action)' },
            hashtags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '۵ تا ۱۰ هشتگ مرتبط بدون علامت #',
            },
            slides: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'متن پیشنهادی اسلایدها در صورت کاروسل بودن',
            },
          },
          required: ['title', 'caption', 'script', 'cta', 'hashtags', 'slides'],
        },
      });

      res.json({
        title: (parsed.title as string) || 'محتوای پیشنهادی',
        caption: (parsed.caption as string) || '',
        script: (parsed.script as string) || '',
        cta: (parsed.cta as string) || '',
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
        slides: Array.isArray(parsed.slides) ? parsed.slides : [],
        tokens,
        modelUsed,
      });
    } catch (err) {
      sendGeminiErrorResponse(res, err, 'خطا در تولید محتوا. لطفاً دوباره تلاش کنید.');
    }
  });

  // 5. Content Repurposing
  app.post('/api/v1/ai/content/repurpose', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { original, targetPlatforms, business } = req.body as {
        original: Record<string, unknown>;
        targetPlatforms: string[];
        business?: Record<string, unknown>;
      };

      if (!verifyBusinessOwnership(req, res, business)) return;
      if (!original || !Array.isArray(targetPlatforms) || targetPlatforms.length === 0) {
        res.status(400).json({ error: 'محتوای مبدا و پلتفرم‌های مقصد الزامی هستند.' });
        return;
      }

      const prompt = [
        `محتوای اصلی را برای پلتفرم‌های زیر بازآفرینی کن (بدون تغییر اصل محتوا): ${targetPlatforms.slice(0, 6).join(', ')}`,
        `عنوان اصلی: ${String(original.title ?? '').slice(0, 300)}`,
        `پلتفرم اصلی: ${String(original.platform ?? '')}`,
        `کپشن اصلی: ${String(original.caption ?? '').slice(0, 5000)}`,
        `سناریو/متن اصلی: ${String(original.script ?? '').slice(0, 5000)}`,
        `\nزمینه برند:\n${formatBusinessContext(business)}`,
      ].join('\n');

      const { parsed, tokens, modelUsed } = await generateStructuredJson({
        requestId: req.requestId || crypto.randomUUID(),
        businessId: String(business!.id),
        ownerId: req.authUser!.uid,
        contents: prompt,
        systemInstruction: `تو متخصص بازآفرینی محتوا (Content Repurposing) هستی. برای هر پلتفرم مقصد یک نسخه بومی‌سازی‌شده و استاندارد بساز.\n${PERSIAN_WRITING_RULES}`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            versions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  platform: { type: Type.STRING },
                  contentType: { type: Type.STRING, description: 'یکی از: post, carousel, reel_script, short_script, video_description, story, thread, newsletter' },
                  title: { type: Type.STRING },
                  caption: { type: Type.STRING },
                  script: { type: Type.STRING },
                  cta: { type: Type.STRING },
                  hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['platform', 'contentType', 'title', 'caption', 'script', 'cta', 'hashtags'],
              },
            },
          },
          required: ['versions'],
        },
      });

      res.json({
        versions: Array.isArray(parsed.versions) ? parsed.versions : [],
        tokens,
        modelUsed,
      });
    } catch (err) {
      sendGeminiErrorResponse(res, err, 'خطا در بازآفرینی محتوا. لطفاً دوباره تلاش کنید.');
    }
  });

  // 6. Campaign Proposal Draft
  app.post('/api/v1/ai/campaigns/draft', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { goalPrompt, campaignType, product, business } = req.body as {
        goalPrompt: string;
        campaignType: string;
        product?: Record<string, unknown>;
        business?: Record<string, unknown>;
      };

      if (!verifyBusinessOwnership(req, res, business)) return;
      if (!goalPrompt || typeof goalPrompt !== 'string' || !goalPrompt.trim()) {
        res.status(400).json({ error: 'هدف کمپین نمی‌تواند خالی باشد.' });
        return;
      }
      if (!validateInputLength(goalPrompt, 5000, 'هدف کمپین', res)) return;

      const prompt = [
        `نوع کمپین: ${String(campaignType ?? '')}`,
        `هدف و توضیح کاربر: ${goalPrompt.trim()}`,
        product ? `محصول مرتبط: ${String(product.name ?? '')} (قیمت: ${String(product.price ?? '')} ${String(product.currency ?? '')})` : '',
        `\nزمینه کسب‌وکار:\n${formatBusinessContext(business)}`,
      ].join('\n');

      const { parsed, tokens, modelUsed } = await generateStructuredJson({
        requestId: req.requestId || crypto.randomUUID(),
        businessId: String(business!.id),
        ownerId: req.authUser!.uid,
        contents: prompt,
        systemInstruction: `تو ایجنت فروش و کمپین‌های بازاریابی هستی. یک طرح کمپین عملیاتی و شفاف آماده کن.\n${PERSIAN_WRITING_RULES}`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            objective: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            keyMessages: { type: Type.ARRAY, items: { type: Type.STRING } },
            launchChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['name', 'objective', 'targetAudience', 'keyMessages', 'launchChecklist'],
        },
      });

      res.json({
        ...parsed,
        tokens,
        modelUsed,
      });
    } catch (err) {
      sendGeminiErrorResponse(res, err, 'خطا در طراحی کمپین. لطفاً دوباره تلاش کنید.');
    }
  });

  // 7. Analytics Report Generator (strictly grounded in real metrics)
  app.post('/api/v1/ai/analytics/report', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { reportType, business, metricsSnapshot } = req.body as {
        reportType: string;
        business?: Record<string, unknown>;
        metricsSnapshot: Record<string, unknown>;
      };

      if (!verifyBusinessOwnership(req, res, business)) return;

      const prompt = [
        `نوع گزارش: ${String(reportType ?? 'weekly')}`,
        `اطلاعات کسب‌وکار:\n${formatBusinessContext(business)}`,
        `\nداده‌های واقعی ثبت‌شده در پایگاه‌داده:\n${JSON.stringify(metricsSnapshot ?? {}, null, 2)}`,
      ].join('\n');

      const { parsed, tokens, modelUsed } = await generateStructuredJson({
        requestId: req.requestId || crypto.randomUUID(),
        businessId: String(business!.id),
        ownerId: req.authUser!.uid,
        contents: prompt,
        systemInstruction: `تو تحلیل‌گر داده کسب‌وکار هستی. گزارش را منحصراً بر پایه اعداد واقعی داده‌شده بنویس. اگر داده‌های بیرونی شبکه‌های اجتماعی متصل نیستند، صراحتاً آن را به عنوان محدودیت داده ذکر کن و هرگز عددی را از خودت نساز.\n${PERSIAN_WRITING_RULES}`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING, description: 'متن کامل گزارش تحلیلی به فارسی با بخش‌های شفاف' },
            dataSourceNote: { type: Type.STRING, description: 'توضیح دقیق منابع داده و داده‌های متصل‌نشده' },
          },
          required: ['title', 'summary', 'dataSourceNote'],
        },
      });

      res.json({
        title: (parsed.title as string) || 'گزارش عملکرد کسب‌وکار',
        summary: (parsed.summary as string) || '',
        dataSourceNote: (parsed.dataSourceNote as string) || 'منبع: رکوردهای واقعی ثبت‌شده در پلتفرم',
        tokens,
        modelUsed,
      });
    } catch (err) {
      sendGeminiErrorResponse(res, err, 'خطا در تولید گزارش تحلیلی. لطفاً دوباره تلاش کنید.');
    }
  });

  // 8. CRM Customer Reply Drafter
  app.post('/api/v1/ai/crm/draft-reply', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { customerName, inquiry, business } = req.body as {
        customerName: string;
        inquiry: string;
        business?: Record<string, unknown>;
      };

      if (!verifyBusinessOwnership(req, res, business)) return;
      if (!inquiry || typeof inquiry !== 'string' || !inquiry.trim()) {
        res.status(400).json({ error: 'متن پیام یا سوال مشتری الزامی است.' });
        return;
      }
      if (!validateInputLength(inquiry, 4000, 'پیام مشتری', res)) return;

      const { parsed, tokens, modelUsed } = await generateStructuredJson({
        requestId: req.requestId || crypto.randomUUID(),
        businessId: String(business!.id),
        ownerId: req.authUser!.uid,
        contents: `نام مخاطب/مشتری: ${String(customerName ?? '').slice(0, 150)}\nپیام یا نیاز ثبت‌شده: ${inquiry.trim()}\n\nاطلاعات کسب‌وکار:\n${formatBusinessContext(business)}`,
        systemInstruction: `تو ایجنت ارتباط با مشتری هستی. یک پیش‌نویس پاسخ محترمانه، دقیق و متناسب با لحن برند بنویس. این پاسخ فقط پیش‌نویس است و ارسال آن نیازمند تأیید مالک است.\n${PERSIAN_WRITING_RULES}`,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            replyDraft: { type: Type.STRING },
            toneNote: { type: Type.STRING },
          },
          required: ['subject', 'replyDraft', 'toneNote'],
        },
      });

      res.json({
        subject: (parsed.subject as string) || `پاسخ به ${customerName}`,
        replyDraft: (parsed.replyDraft as string) || '',
        toneNote: (parsed.toneNote as string) || '',
        tokens,
        modelUsed,
      });
    } catch (err) {
      sendGeminiErrorResponse(res, err, 'خطا در نگارش پیش‌نویس پاسخ مشتری. لطفاً دوباره تلاش کنید.');
    }
  });

  // ===========================================================================
  // 9. Real AI Image Generation, Editing, Composition & Persistent Media Store
  // ===========================================================================
  async function executeImageGenerationJob(params: {
    jobId: string;
    requestId: string;
    business: Record<string, unknown>;
    ownerId: string;
    prompt: string;
    negativePrompt?: string;
    visualStyle?: string;
    aspectRatio: ImageAspectRatio;
    format?: VisualFormatKey;
    resolution?: '1K' | '2K' | '4K';
    numberOfImages: number;
    preferredModelId?: string;
    contentId?: string;
    purpose?: string;
    composeBrandOverlay?: {
      enabled?: boolean;
      headline?: string;
      subheadline?: string;
      ctaText?: string;
      logoMediaId?: string;
    };
  }) {
    const bizId = String(params.business.id);
    const brand = (params.business.brandSettings as Record<string, unknown> | undefined) ?? {};
    const primaryColor = typeof brand.primaryColor === 'string' ? brand.primaryColor : '#6366F1';
    const secondaryColor = typeof brand.secondaryColor === 'string' ? brand.secondaryColor : '#8B5CF6';
    const brandName = String(params.business.name ?? '').slice(0, 60);

    try {
      imageJobManager.updateStatus(params.jobId, { status: 'generating' });

      const styleInstructions = [
        params.visualStyle ? `Visual Style: ${params.visualStyle}` : '',
        `Brand Palette Inspiration: primary ${primaryColor}, accent ${secondaryColor}`,
        brand.personality ? `Brand Aesthetic: ${String(brand.personality).slice(0, 140)}` : '',
        'No garbled text, high aesthetic contrast, studio composition suitable for social media creative.',
      ]
        .filter(Boolean)
        .join('. ');

      const aiRes = await aiRouter.generateImage(
        {
          requestId: params.requestId,
          businessId: bizId,
          ownerId: params.ownerId,
          preferredModelId: params.preferredModelId,
        },
        {
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          numberOfImages: params.numberOfImages,
          styleInstructions,
          purpose: params.purpose,
        }
      );

      imageJobManager.updateStatus(params.jobId, {
        status: 'processing',
        providerId: aiRes.providerId,
        modelUsed: aiRes.modelUsed,
        fallbackUsed: aiRes.fallbackUsed,
        estimatedCostUsd: aiRes.estimatedCostUsd,
        latencyMs: aiRes.latencyMs,
      });

      let logoBuf: Buffer | undefined;
      let logoMime: string | undefined;
      if (params.composeBrandOverlay?.logoMediaId) {
        const logoData = await persistentMediaStore.readMediaBuffer(
          bizId,
          params.composeBrandOverlay.logoMediaId,
          params.ownerId
        );
        if (logoData) {
          logoBuf = logoData.buffer;
          logoMime = logoData.record.mimeType;
        }
      }

      const savedAssets = [];
      for (let idx = 0; idx < aiRes.images.length; idx += 1) {
        const img = aiRes.images[idx];
        const rawBuffer = Buffer.from(img.dataBase64, 'base64');

        // Normalize aspect/dimensions when a social format target is selected
        const normalized = await normalizeImageToTargetDimensions({
          sourceBuffer: rawBuffer,
          sourceMimeType: img.mimeType,
          format: params.format,
          aspectRatio: params.aspectRatio,
        });

        imageJobManager.updateStatus(params.jobId, { status: 'saving' });

        const rawSaved = await persistentMediaStore.saveImageBuffer({
          businessId: bizId,
          ownerId: params.ownerId,
          buffer: normalized.buffer,
          mimeType: normalized.mimeType,
          fileName: `ai-${params.format || params.aspectRatio.replace(':', 'x')}-${Date.now()}-${idx + 1}.${
            normalized.mimeType.includes('jpeg') ? 'jpg' : 'png'
          }`,
          width: normalized.width,
          height: normalized.height,
          aspectRatio: normalized.aspectRatio,
          purpose: params.purpose,
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          styleInstructions,
          providerId: aiRes.providerId,
          modelId: aiRes.modelUsed,
          latencyMs: aiRes.latencyMs,
          estimatedCostUsd: Number((aiRes.estimatedCostUsd / aiRes.images.length).toFixed(4)),
          contentId: params.contentId,
          composed: false,
        });
        savedAssets.push(rawSaved);

        if (params.composeBrandOverlay?.enabled) {
          const composed = await composeBrandVisual({
            sourceBuffer: normalized.buffer,
            sourceMimeType: normalized.mimeType,
            format: params.format,
            aspectRatio: normalized.aspectRatio,
            brandName,
            headline: params.composeBrandOverlay.headline,
            subheadline: params.composeBrandOverlay.subheadline,
            ctaText: params.composeBrandOverlay.ctaText,
            primaryColor,
            secondaryColor,
            logoBuffer: logoBuf,
            logoMimeType: logoMime,
          });
          const composedSaved = await persistentMediaStore.saveImageBuffer({
            businessId: bizId,
            ownerId: params.ownerId,
            buffer: composed.buffer,
            mimeType: composed.mimeType,
            fileName: `branded-${params.format || params.aspectRatio.replace(':', 'x')}-${Date.now()}-${idx + 1}.png`,
            width: composed.width,
            height: composed.height,
            aspectRatio: composed.aspectRatio,
            purpose: params.purpose,
            prompt: params.prompt,
            negativePrompt: params.negativePrompt,
            styleInstructions,
            providerId: aiRes.providerId,
            modelId: aiRes.modelUsed,
            latencyMs: aiRes.latencyMs,
            estimatedCostUsd: 0,
            contentId: params.contentId,
            parentMediaId: rawSaved.id,
            versionNumber: 2,
            composed: true,
          });
          savedAssets.push(composedSaved);
        }

        imageJobManager.updateStatus(params.jobId, {
          completedCount: idx + 1,
          assets: [...savedAssets],
        });
      }

      const finalJob = imageJobManager.updateStatus(params.jobId, {
        status: 'completed',
        completedCount: aiRes.images.length,
        assets: savedAssets,
      });
      return finalJob;
    } catch (err: unknown) {
      const mapped = formatActionableImageError(err);
      imageJobManager.updateStatus(params.jobId, {
        status: 'failed',
        errorCode: mapped.code,
        errorMessage: mapped.error,
      });
      throw err;
    }
  }

  app.post('/api/v1/ai/images/generate', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        business,
        prompt,
        negativePrompt,
        visualStyle,
        aspectRatio = '1:1',
        format,
        resolution = '1K',
        numberOfImages = 1,
        preferredModelId,
        contentId,
        purpose,
        composeBrandOverlay,
        async: runAsync,
      } = req.body as {
        business?: Record<string, unknown>;
        prompt?: string;
        negativePrompt?: string;
        visualStyle?: string;
        aspectRatio?: ImageAspectRatio;
        format?: VisualFormatKey;
        resolution?: '1K' | '2K' | '4K';
        numberOfImages?: number;
        preferredModelId?: string;
        contentId?: string;
        purpose?: string;
        composeBrandOverlay?: {
          enabled?: boolean;
          headline?: string;
          subheadline?: string;
          ctaText?: string;
          logoMediaId?: string;
        };
        async?: boolean;
      };

      if (!verifyBusinessOwnership(req, res, business)) return;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        res.status(400).json({ error: 'توضیح یا پرامپت تصویر نمی‌تواند خالی باشد.' });
        return;
      }
      if (!validateInputLength(prompt, 4000, 'پرامپت تصویر', res)) return;

      const safeCount = Math.min(4, Math.max(1, Math.round(Number(numberOfImages) || 1)));
      const resolvedDims = resolveFormatDimensions(format, aspectRatio);
      const bizId = String(business!.id);

      const job = imageJobManager.createJob({
        businessId: bizId,
        ownerId: req.authUser!.uid,
        requestedCount: safeCount,
        aspectRatio: resolvedDims.aspectRatio,
        format,
        prompt: prompt.trim(),
        retryPayload: req.body as Record<string, unknown>,
      });

      const jobPromise = executeImageGenerationJob({
        jobId: job.jobId,
        requestId: req.requestId || crypto.randomUUID(),
        business: business!,
        ownerId: req.authUser!.uid,
        prompt: prompt.trim(),
        negativePrompt,
        visualStyle,
        aspectRatio: resolvedDims.aspectRatio,
        format,
        resolution,
        numberOfImages: safeCount,
        preferredModelId,
        contentId,
        purpose,
        composeBrandOverlay,
      });

      if (runAsync) {
        jobPromise.catch((err) => {
          console.warn('Async image generation job failed:', job.jobId, err instanceof Error ? err.message : String(err));
        });
        res.status(202).json({ job });
        return;
      }

      const completedJob = await jobPromise;
      res.json({
        job: completedJob,
        assets: completedJob?.assets ?? [],
        providerId: completedJob?.providerId,
        modelUsed: completedJob?.modelUsed,
        fallbackUsed: completedJob?.fallbackUsed,
        latencyMs: completedJob?.latencyMs,
        estimatedCostUsd: completedJob?.estimatedCostUsd,
      });
    } catch (err) {
      const mapped = formatActionableImageError(err);
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  app.get('/api/v1/ai/images/jobs/:jobId', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : '';
    if (!businessId) {
      res.status(400).json({ error: 'شناسه کسب‌وکار الزامی است.' });
      return;
    }
    const job = imageJobManager.getJob(req.params.jobId, businessId, req.authUser!.uid);
    if (!job) {
      res.status(404).json({ error: 'کار تولید تصویر یافت نشد یا متعلق به این کسب‌وکار نیست.' });
      return;
    }
    res.json({ job });
  });

  app.post('/api/v1/ai/images/jobs/:jobId/retry', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = req.body?.business as Record<string, unknown> | undefined;
    if (!verifyBusinessOwnership(req, res, business)) return;
    const prevJob = imageJobManager.getJob(req.params.jobId, String(business!.id), req.authUser!.uid);
    if (!prevJob || !prevJob.retryPayload) {
      res.status(404).json({ error: 'سابقه کار برای تلاش مجدد یافت نشد.' });
      return;
    }

    const payload = prevJob.retryPayload;
    const newJob = imageJobManager.createJob({
      businessId: String(business!.id),
      ownerId: req.authUser!.uid,
      requestedCount: prevJob.requestedCount,
      aspectRatio: prevJob.aspectRatio,
      format: prevJob.format,
      prompt: prevJob.prompt,
      retryPayload: payload,
    });

    executeImageGenerationJob({
      jobId: newJob.jobId,
      requestId: req.requestId || crypto.randomUUID(),
      business: business!,
      ownerId: req.authUser!.uid,
      prompt: prevJob.prompt,
      negativePrompt: typeof payload.negativePrompt === 'string' ? payload.negativePrompt : undefined,
      visualStyle: typeof payload.visualStyle === 'string' ? payload.visualStyle : undefined,
      aspectRatio: prevJob.aspectRatio,
      format: prevJob.format as VisualFormatKey | undefined,
      resolution: (payload.resolution as '1K' | '2K' | '4K') || '1K',
      numberOfImages: prevJob.requestedCount,
      preferredModelId: typeof payload.preferredModelId === 'string' ? payload.preferredModelId : undefined,
      contentId: typeof payload.contentId === 'string' ? payload.contentId : undefined,
      purpose: typeof payload.purpose === 'string' ? payload.purpose : undefined,
      composeBrandOverlay: payload.composeBrandOverlay as {
        enabled?: boolean;
        headline?: string;
        subheadline?: string;
        ctaText?: string;
        logoMediaId?: string;
      },
    }).catch((err) => {
      console.warn('Retry image job failed:', newJob.jobId, err instanceof Error ? err.message : String(err));
    });

    res.status(202).json({ job: newJob });
  });

  app.post('/api/v1/ai/images/edit', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { business, sourceMediaId, editMode = 'custom', instruction, aspectRatio, preferredModelId } = req.body as {
        business?: Record<string, unknown>;
        sourceMediaId?: string;
        editMode?: string;
        instruction?: string;
        aspectRatio?: ImageAspectRatio;
        preferredModelId?: string;
      };
      if (!verifyBusinessOwnership(req, res, business)) return;
      const bizId = String(business!.id);
      if (!sourceMediaId) {
        res.status(400).json({ error: 'شناسه تصویر مبدا برای ویرایش الزامی است.' });
        return;
      }

      const sourceData = await persistentMediaStore.readMediaBuffer(bizId, sourceMediaId, req.authUser!.uid);
      if (!sourceData) {
        res.status(404).json({ error: 'تصویر مبدا در فضای ذخیره‌سازی این کسب‌وکار یافت نشد.' });
        return;
      }

      const modePrompts: Record<string, string> = {
        change_background: 'Change the background scene cleanly while keeping the main subject intact:',
        remove_object: 'Cleanly remove unwanted distractions/objects and inpaint seamlessly:',
        change_style: 'Transform the visual aesthetic and lighting style while preserving the core subject:',
        variation: 'Generate a refined creative variation of this visual with fresh composition:',
        replace_product_bg: 'Place the main product on a premium studio surface and cohesive luxury backdrop:',
        add_text_space: 'Expand negative clean space cleanly at top/bottom for readable Persian social headline overlay:',
        adjust_composition: 'Rebalance framing, lighting contrast, and focal hierarchy:',
        custom: 'Apply this visual edit carefully:',
      };

      const prefix = modePrompts[editMode] || modePrompts.custom;
      const fullPrompt = `${prefix} ${(instruction || '').trim()}`.trim();
      if (!fullPrompt || fullPrompt.length < 6) {
        res.status(400).json({ error: 'توضیح ویرایش تصویر را وارد کنید.' });
        return;
      }

      const isVariation = editMode === 'variation';
      const targetAspect = aspectRatio || sourceData.record.aspectRatio || '1:1';

      const aiRes = await aiRouter.generateImage(
        {
          requestId: req.requestId || crypto.randomUUID(),
          businessId: bizId,
          ownerId: req.authUser!.uid,
          preferredModelId,
        },
        {
          prompt: fullPrompt,
          aspectRatio: targetAspect,
          referenceImageBase64: sourceData.buffer.toString('base64'),
          referenceImageMimeType: sourceData.record.mimeType,
          isVariation,
        }
      );

      const outImg = aiRes.images[0];
      const rawBuf = Buffer.from(outImg.dataBase64, 'base64');
      const normalized = await normalizeImageToTargetDimensions({
        sourceBuffer: rawBuf,
        sourceMimeType: outImg.mimeType,
        aspectRatio: targetAspect,
      });

      const savedVersion = await persistentMediaStore.saveImageBuffer({
        businessId: bizId,
        ownerId: req.authUser!.uid,
        buffer: normalized.buffer,
        mimeType: normalized.mimeType,
        fileName: `edit-v${sourceData.record.versionNumber + 1}-${Date.now()}.${
          normalized.mimeType.includes('jpeg') ? 'jpg' : 'png'
        }`,
        width: normalized.width,
        height: normalized.height,
        aspectRatio: normalized.aspectRatio,
        purpose: sourceData.record.purpose,
        prompt: fullPrompt,
        providerId: aiRes.providerId,
        modelId: aiRes.modelUsed,
        latencyMs: aiRes.latencyMs,
        estimatedCostUsd: aiRes.estimatedCostUsd,
        contentId: sourceData.record.contentId,
        parentMediaId: sourceData.record.id,
        versionNumber: sourceData.record.versionNumber + 1,
        composed: false,
        editMode,
      });

      res.json({
        asset: savedVersion,
        providerId: aiRes.providerId,
        modelUsed: aiRes.modelUsed,
        fallbackUsed: aiRes.fallbackUsed,
        latencyMs: aiRes.latencyMs,
        estimatedCostUsd: aiRes.estimatedCostUsd,
      });
    } catch (err) {
      const mapped = formatActionableImageError(err);
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  app.post('/api/v1/ai/images/compose', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        business,
        sourceMediaId,
        format = 'square_post',
        aspectRatio,
        headline,
        subheadline,
        ctaText,
        logoMediaId,
      } = req.body as {
        business?: Record<string, unknown>;
        sourceMediaId?: string;
        format?: VisualFormatKey;
        aspectRatio?: ImageAspectRatio;
        headline?: string;
        subheadline?: string;
        ctaText?: string;
        logoMediaId?: string;
      };
      if (!verifyBusinessOwnership(req, res, business)) return;
      const bizId = String(business!.id);
      if (!sourceMediaId) {
        res.status(400).json({ error: 'شناسه تصویر مبدا برای ترکیب گرافیکی الزامی است.' });
        return;
      }

      const sourceData = await persistentMediaStore.readMediaBuffer(bizId, sourceMediaId, req.authUser!.uid);
      if (!sourceData) {
        res.status(404).json({ error: 'تصویر مبدا یافت نشد.' });
        return;
      }

      let logoBuf: Buffer | undefined;
      let logoMime: string | undefined;
      if (logoMediaId) {
        const logoData = await persistentMediaStore.readMediaBuffer(bizId, logoMediaId, req.authUser!.uid);
        if (logoData) {
          logoBuf = logoData.buffer;
          logoMime = logoData.record.mimeType;
        }
      }

      const brand = (business!.brandSettings as Record<string, unknown> | undefined) ?? {};
      const composed = await composeBrandVisual({
        sourceBuffer: sourceData.buffer,
        sourceMimeType: sourceData.record.mimeType,
        format,
        aspectRatio,
        brandName: String(business!.name ?? ''),
        headline,
        subheadline,
        ctaText,
        primaryColor: typeof brand.primaryColor === 'string' ? brand.primaryColor : '#6366F1',
        secondaryColor: typeof brand.secondaryColor === 'string' ? brand.secondaryColor : '#8B5CF6',
        logoBuffer: logoBuf,
        logoMimeType: logoMime,
      });

      const saved = await persistentMediaStore.saveImageBuffer({
        businessId: bizId,
        ownerId: req.authUser!.uid,
        buffer: composed.buffer,
        mimeType: composed.mimeType,
        fileName: `composed-${format}-v${sourceData.record.versionNumber + 1}-${Date.now()}.png`,
        width: composed.width,
        height: composed.height,
        aspectRatio: composed.aspectRatio,
        purpose: format,
        prompt: sourceData.record.prompt,
        providerId: sourceData.record.providerId,
        modelId: sourceData.record.modelId,
        contentId: sourceData.record.contentId,
        parentMediaId: sourceData.record.id,
        versionNumber: sourceData.record.versionNumber + 1,
        composed: true,
        editMode: 'brand_composition',
      });

      res.json({ asset: saved });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ترکیب گرافیکی تصویر با هویت برند.' });
    }
  });

  // Persistent Media Library APIs (strict tenant isolation + HMAC-signed URLs)
  app.post('/api/v1/media/list', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = req.body?.business as Record<string, unknown> | undefined;
    if (!verifyBusinessOwnership(req, res, business)) return;
    const assets = persistentMediaStore.listByBusiness(String(business!.id), req.authUser!.uid);
    res.json({ assets });
  });

  app.post('/api/v1/media/attach', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const { business, mediaId, contentId } = req.body as {
      business?: Record<string, unknown>;
      mediaId?: string;
      contentId?: string;
    };
    if (!verifyBusinessOwnership(req, res, business)) return;
    if (!mediaId || !contentId) {
      res.status(400).json({ error: 'شناسه رسانه و محتوا الزامی است.' });
      return;
    }
    const updated = persistentMediaStore.attachContentId(
      String(business!.id),
      req.authUser!.uid,
      mediaId,
      contentId
    );
    if (!updated) {
      res.status(404).json({ error: 'فایل رسانه یافت نشد.' });
      return;
    }
    res.json({ asset: updated });
  });

  app.get('/api/v1/media/file/:businessId/:mediaId', async (req: Request, res: Response) => {
    const { businessId, mediaId } = req.params;
    const exp = typeof req.query.exp === 'string' ? req.query.exp : '';
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';

    if (!persistentMediaStore.verifySignedUrl(businessId, mediaId, exp, sig)) {
      res.status(403).json({ error: 'دسترسی غیرمجاز یا لینک رسانه منقضی شده است.' });
      return;
    }

    const found = await persistentMediaStore.readMediaBuffer(businessId, mediaId);
    if (!found) {
      res.status(404).json({ error: 'فایل رسانه یافت نشد.' });
      return;
    }

    res.setHeader('Content-Type', found.record.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(found.record.fileName)}"`);
    }
    res.send(found.buffer);
  });

  app.delete('/api/v1/media/:businessId/:mediaId', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { businessId, mediaId } = req.params;
    const deleted = await persistentMediaStore.deleteMedia(businessId, req.authUser!.uid, mediaId);
    if (!deleted) {
      res.status(404).json({ error: 'فایل رسانه یافت نشد یا متعلق به شما نیست.' });
      return;
    }
    res.json({ ok: true });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
