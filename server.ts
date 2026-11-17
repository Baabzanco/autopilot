import 'dotenv/config';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

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

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const GEMINI_MODEL = 'gemini-4-hydrogen';
// Verified available models via ModelService.ListModels for resilient failover when gemini-4-hydrogen returns 503 UNAVAILABLE
const GEMINI_MODEL_CASCADE = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'] as const;
const modelCooldownUntil = new Map<string, number>();

function parseStructuredJsonText(rawText: string | undefined): Record<string, unknown> {
  const trimmed = (rawText ?? '').trim();
  if (!trimmed) return {};
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(stripped) as Record<string, unknown>;
}

async function generateStructuredJson(params: {
  contents: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
}): Promise<{
  parsed: Record<string, unknown>;
  tokens: { input: number; output: number; estimatedCostUsd: number };
  modelUsed: string;
}> {
  const ai = getGeminiClient();
  const now = Date.now();
  let lastError: unknown = null;

  const candidateModels = [
    ...GEMINI_MODEL_CASCADE.filter((m) => (modelCooldownUntil.get(m) ?? 0) <= now),
    ...GEMINI_MODEL_CASCADE.filter((m) => (modelCooldownUntil.get(m) ?? 0) > now),
  ];

  for (const modelName of candidateModels) {
    const timeoutMs = modelName === 'gemini-4-hydrogen' ? 5500 : 25000;
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
          abortSignal: abortController.signal,
        },
      });
      clearTimeout(timer);
      const parsed = parseStructuredJsonText(response.text);
      return {
        parsed,
        tokens: calculateTokenStats(response.usageMetadata),
        modelUsed: modelName,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      lastError = err;
      const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 0;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTransientOrTimeout =
        status === 503 ||
        status === 429 ||
        status === 500 ||
        status === 504 ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('high demand') ||
        errMsg.includes('AbortError') ||
        errMsg.includes('aborted');

      if (isTransientOrTimeout) {
        // Put overloaded/slow model on a 90s cooldown so subsequent requests immediately route to healthy fallback
        modelCooldownUntil.set(modelName, Date.now() + 90_000);
        console.warn(`Model ${modelName} transient/timeout (${status || 'timeout'}), falling back to next verified model.`);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('ALL_MODELS_UNAVAILABLE');
}

function sendGeminiErrorResponse(res: Response, err: unknown, defaultFaMessage: string) {
  const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500;
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Gemini endpoint error:', { status, message: msg.slice(0, 300) });

  if (msg === 'GEMINI_API_KEY_MISSING') {
    res.status(503).json({
      error: 'کلید سرویس هوش مصنوعی (GEMINI_API_KEY) در محیط سرور تنظیم نشده است.',
      code: 'GEMINI_API_KEY_MISSING',
    });
    return;
  }
  if (status === 503 || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
    res.status(503).json({
      error: 'سرویس هوش مصنوعی در حال حاضر با ترافیک بالا روبه‌رو است. لطفاً چند ثانیه دیگر دوباره تلاش کنید.',
      code: 'MODEL_OVERLOADED',
    });
    return;
  }
  if (status === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    res.status(429).json({
      error: 'سهمیه درخواست‌های سرویس هوش مصنوعی موقتاً تکمیل شده است. لطفاً کمی بعد تلاش کنید.',
      code: 'QUOTA_EXCEEDED',
    });
    return;
  }
  res.status(500).json({ error: defaultFaMessage, code: 'AI_GENERATION_FAILED' });
}

function calculateTokenStats(usage?: { promptTokenCount?: number; candidatesTokenCount?: number }) {
  const input = usage?.promptTokenCount ?? 0;
  const output = usage?.candidatesTokenCount ?? 0;
  const estimatedCostUsd = Number(((input * 0.00000015) + (output * 0.0000006)).toFixed(6));
  return { input, output, estimatedCostUsd };
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
  app.use(express.json({ limit: '1mb' }));

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
    res.json({ ok: true, model: GEMINI_MODEL, fallbackModels: GEMINI_MODEL_CASCADE });
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
