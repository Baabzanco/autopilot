import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { computePayloadHash, slugifyText } from '../lib/localization';
import type {
  ActivityLog,
  Agent,
  AgentType,
  AiChatMessage,
  AnalyticsReport,
  Approval,
  ApprovalCategory,
  Automation,
  AutomationRun,
  Business,
  BusinessMemoryItem,
  Campaign,
  Contact,
  ContentItem,
  Integration,
  MediaAsset,
  Order,
  Product,
  Task,
  UserProfile,
} from '../types/domain';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function clampStr(val: string | undefined, maxLen: number): string {
  return (val ?? '').trim().slice(0, maxLen);
}

// ============================================================================
// User Profile
// ============================================================================

export async function ensureUserProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}): Promise<UserProfile> {
  const path = `users/${params.uid}`;
  const ref = doc(db, 'users', params.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    const profile: UserProfile = {
      id: params.uid,
      email: clampStr(params.email, 254),
      displayName: clampStr(params.displayName || 'کاربر سازنده', 120),
      avatarUrl: clampStr(params.avatarUrl, 500),
      preferredLocale: 'fa',
      preferredNumerals: 'persian',
      preferredCurrency: 'IRT',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return profile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateUserProfile(
  uid: string,
  patch: Partial<
    Pick<
      UserProfile,
      'displayName' | 'avatarUrl' | 'preferredLocale' | 'preferredNumerals' | 'preferredCurrency' | 'activeBusinessId'
    >
  >
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.displayName !== undefined) clean.displayName = clampStr(patch.displayName, 120) || 'کاربر';
    if (patch.avatarUrl !== undefined) clean.avatarUrl = clampStr(patch.avatarUrl, 500);
    if (patch.preferredLocale !== undefined) clean.preferredLocale = patch.preferredLocale;
    if (patch.preferredNumerals !== undefined) clean.preferredNumerals = patch.preferredNumerals;
    if (patch.preferredCurrency !== undefined) clean.preferredCurrency = patch.preferredCurrency;
    if (patch.activeBusinessId !== undefined) clean.activeBusinessId = clampStr(patch.activeBusinessId, 128);
    await updateDoc(doc(db, 'users', uid), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// Business & Bootstrap
// ============================================================================

export async function fetchOwnerBusinesses(ownerId: string): Promise<Business[]> {
  const path = 'businesses';
  try {
    const q = query(collection(db, 'businesses'), where('ownerId', '==', ownerId), limit(10));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Business);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createBusinessWorkspace(params: {
  ownerId: string;
  name: string;
  creatorName: string;
}): Promise<Business> {
  const businessId = makeId('biz');
  const path = `businesses/${businessId}`;
  try {
    const business: Business = {
      id: businessId,
      ownerId: params.ownerId,
      name: clampStr(params.name, 140) || 'کسب‌وکار محتوایی من',
      creatorName: clampStr(params.creatorName, 120) || 'سازنده محتوا',
      slug: slugifyText(params.name),
      category: 'تولید محتوای آموزشی و دیجیتال',
      niche: '',
      description: '',
      website: '',
      location: 'ایران',
      primaryLanguage: 'fa',
      currency: 'IRT',
      numeralStyle: 'persian',
      timezone: 'Asia/Tehran',
      onboardingStep: 1,
      onboardingStatus: 'in_progress',
      profileSummary: '',
      profileConfirmed: false,
      creatorProfile: {
        mainPlatforms: ['instagram', 'telegram'],
        experienceLevel: 'در حال رشد',
        expertiseTopics: '',
        preferredFormats: ['carousel', 'reel_script'],
      },
      audienceProfile: {
        description: '',
        ageRange: '۱۸ تا ۳۵ سال',
        location: 'ایران و فارسی‌زبانان',
        interests: '',
        painPoints: '',
        goals: '',
        preferredLanguage: 'فارسی',
      },
      brandSettings: {
        voice: 'صمیمی، حرفه‌ای و کاربردی',
        communicationStyle: 'محاوره‌ای استاندارد',
        personality: 'شفاف، نتیجه‌محور و قابل اعتماد',
        preferredTerms: '',
        avoidWords: '',
        primaryColor: '#6366F1',
        secondaryColor: '#8B5CF6',
      },
      businessGoals: {
        audienceGoal: '',
        publishingCadence: '۴ پست در هفته',
        engagementGoal: '',
        revenueGoal: '',
        primaryObjective: '',
      },
      monetizationModels: ['digital_products'],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, 'businesses', businessId), business);
    await seedDefaultBusinessModules(businessId, params.ownerId);
    await updateUserProfile(params.ownerId, { activeBusinessId: businessId });
    await logActivity(businessId, params.ownerId, {
      actorType: 'system',
      actorName: 'سیستم',
      action: 'ایجاد فضای کاری کسب‌وکار',
      entityType: 'business',
      entityId: businessId,
      details: `کسب‌وکار «${business.name}» با ۵ ایجنت تخصصی و قوانین نظارت انسانی راه‌اندازی شد.`,
    });
    return business;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

async function seedDefaultBusinessModules(businessId: string, ownerId: string): Promise<void> {
  const defaultAgents: Array<Omit<Agent, 'createdAt' | 'updatedAt'>> = [
    {
      id: 'agent_chief_manager',
      businessId,
      ownerId,
      agentType: 'chief_manager',
      name: 'مدیر ارشد هوش مصنوعی',
      role: 'هماهنگ‌کننده مرکزی کسب‌وکار',
      description: 'درک اهداف کسب‌وکار، شکستن درخواست‌های پیچیده به وظایف تخصصی و هماهنگی سایر ایجنت‌ها تحت نظارت شما.',
      status: 'active',
      enabled: true,
      responsibilities: [
        'تحلیل اولویت‌های روزانه کسب‌وکار',
        'ارجاع وظایف به ایجنت‌های تخصصی',
        'جمع‌بندی نتایج و آماده‌سازی درخواست تأیید',
      ],
      allowedTools: ['حافظه کسب‌وکار', 'مدیریت وظایف', 'تحلیل داده‌های ثبت‌شده'],
      preferredTone: 'استراتژیک و شفاف',
      outputLanguage: 'fa',
      totalTokensUsed: 0,
      estimatedCostUsd: 0,
      tasksCompleted: 0,
    },
    {
      id: 'agent_content',
      businessId,
      ownerId,
      agentType: 'content',
      name: 'ایجنت تولید محتوا',
      role: 'استراتژیست و نویسنده محتوا',
      description: 'ایده‌پردازی، نگارش کپشن استاندارد فارسی با نیم‌فاصله، طراحی اسلاید کاروسل، سناریوی ریلز و بازآفرینی محتوا.',
      status: 'idle',
      enabled: true,
      responsibilities: [
        'نگارش کپشن و قلاب (Hook) اینستاگرام و تلگرام',
        'طراحی سناریو ویدیوی کوتاه و یوتیوب',
        'تبدیل محتوای موجود به فرمت‌های چندپلتفرمی',
      ],
      allowedTools: ['استودیو محتوا', 'حافظه برند', 'درخواست تأیید انتشار'],
      preferredTone: 'مطابق لحن برند',
      outputLanguage: 'fa',
      totalTokensUsed: 0,
      estimatedCostUsd: 0,
      tasksCompleted: 0,
    },
    {
      id: 'agent_research_growth',
      businessId,
      ownerId,
      agentType: 'research_growth',
      name: 'ایجنت تحقیق و رشد',
      role: 'تحلیل‌گر بازار و رشد مخاطب',
      description: 'شناسایی فرصت‌های محتوایی، تحلیل الگوهای تعامل داده‌های ثبت‌شده و پیشنهاد آزمایش‌های رشد بدون آمارسازی.',
      status: 'idle',
      enabled: true,
      responsibilities: [
        'یافتن شکاف‌ها و فرصت‌های محتوایی',
        'پیشنهاد موضوعات پربازده بر اساس نیاز مخاطبان',
        'طراحی آزمایش‌های رشد قابل اندازه‌گیری',
      ],
      allowedTools: ['حافظه مخاطبان', 'گزارش‌های تحلیلی', 'آزمایش محتوا'],
      preferredTone: 'تحلیلی و مستند',
      outputLanguage: 'fa',
      totalTokensUsed: 0,
      estimatedCostUsd: 0,
      tasksCompleted: 0,
    },
    {
      id: 'agent_sales',
      businessId,
      ownerId,
      agentType: 'sales_monetization',
      name: 'ایجنت فروش و درآمدزایی',
      role: 'متخصص تبدیل مخاطب به مشتری',
      description: 'طراحی متن معرفی محصولات دیجیتال، پیشنهاد کمپین فروش و تهیه پیش‌نویس پیام پیگیری مشتریان (با تأیید مالک).',
      status: 'idle',
      enabled: true,
      responsibilities: [
        'نگارش متن معرفی و لندینگ محصول',
        'پیشنهاد کمپین‌های فصلی و پروموشن',
        'تحلیل سبد محصولات و پیشنهاد ارتقا',
      ],
      allowedTools: ['کاتالوگ محصولات', 'کمپین‌ها', 'درخواست تأیید فروش'],
      preferredTone: 'اقناع‌کننده و صادقانه',
      outputLanguage: 'fa',
      totalTokensUsed: 0,
      estimatedCostUsd: 0,
      tasksCompleted: 0,
    },
    {
      id: 'agent_crm',
      businessId,
      ownerId,
      agentType: 'customer_relationship',
      name: 'ایجنت ارتباط با مشتری',
      role: 'مدیریت پاسخگویی و CRM',
      description: 'دسته‌بندی پیام‌های مخاطبان، تهیه پیش‌نویس پاسخ پشتیبانی و تحلیل بازخورد مشتریان برای تصمیم‌گیری سریع‌تر.',
      status: 'idle',
      enabled: true,
      responsibilities: [
        'دسته‌بندی سرنخ‌ها و مشتریان',
        'تهیه پیش‌نویس پاسخ محترمانه و دقیق',
        'استخراج سوالات پرتکرار مخاطبان',
      ],
      allowedTools: ['سوابق CRM', 'درخواست تأیید ارسال پاسخ'],
      preferredTone: 'محترمانه و پیگیر',
      outputLanguage: 'fa',
      totalTokensUsed: 0,
      estimatedCostUsd: 0,
      tasksCompleted: 0,
    },
  ];

  for (const ag of defaultAgents) {
    await setDoc(doc(db, 'businesses', businessId, 'agents', ag.id), {
      ...ag,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const defaultIntegrations: Array<Omit<Integration, 'createdAt' | 'updatedAt'>> = [
    {
      id: 'int_instagram',
      businessId,
      ownerId,
      provider: 'instagram',
      displayName: 'اینستاگرام (Instagram Graph API)',
      category: 'social',
      connectionStatus: 'not_connected',
      scopes: ['instagram_basic', 'instagram_content_publish'],
      statusNote: 'متصل نشده — برای انتشار خودکار پس از تأیید، اتصال رسمی OAuth لازم است. هم‌اکنون انتشار دستی فعال است.',
    },
    {
      id: 'int_telegram',
      businessId,
      ownerId,
      provider: 'telegram',
      displayName: 'کانال تلگرام (Telegram Bot API)',
      category: 'messaging',
      connectionStatus: 'not_connected',
      scopes: ['send_message'],
      statusNote: 'متصل نشده — توکن ربات تنظیم نشده است.',
    },
    {
      id: 'int_youtube',
      businessId,
      ownerId,
      provider: 'youtube',
      displayName: 'یوتیوب (YouTube Data API)',
      category: 'social',
      connectionStatus: 'not_connected',
      scopes: ['youtube.readonly', 'youtube.upload'],
      statusNote: 'متصل نشده — داده‌های بازدید تا زمان اتصال در دسترس نیستند.',
    },
    {
      id: 'int_linkedin',
      businessId,
      ownerId,
      provider: 'linkedin',
      displayName: 'لینکدین (LinkedIn Marketing API)',
      category: 'social',
      connectionStatus: 'not_connected',
      scopes: ['w_member_social'],
      statusNote: 'متصل نشده — می‌توانید متن را در استودیو تولید و به‌صورت دستی منتشر کنید.',
    },
    {
      id: 'int_tiktok',
      businessId,
      ownerId,
      provider: 'tiktok',
      displayName: 'تیک‌تاک (TikTok Content Posting API)',
      category: 'social',
      connectionStatus: 'not_connected',
      scopes: ['video.publish'],
      statusNote: 'متصل نشده.',
    },
    {
      id: 'int_zarinpal',
      businessId,
      ownerId,
      provider: 'zarinpal',
      displayName: 'درگاه پرداخت زرین‌پال (Zarinpal)',
      category: 'payment',
      connectionStatus: 'not_connected',
      scopes: ['payment_request', 'payment_verify'],
      statusNote: 'درگاه بانکی متصل نشده — امکان ثبت سفارش آزمایشی/دستی در سیستم فعال است.',
    },
    {
      id: 'int_stripe',
      businessId,
      ownerId,
      provider: 'stripe',
      displayName: 'درگاه بین‌المللی Stripe',
      category: 'payment',
      connectionStatus: 'not_connected',
      scopes: ['checkout.sessions', 'webhooks'],
      statusNote: 'متصل نشده.',
    },
    {
      id: 'int_email',
      businessId,
      ownerId,
      provider: 'email',
      displayName: 'سرویس ارسال ایمیل و خبرنامه',
      category: 'messaging',
      connectionStatus: 'not_connected',
      scopes: ['smtp.send'],
      statusNote: 'متصل نشده — هیچ ایمیلی بدون تأیید مالک و اتصال سرویس ارسال نمی‌شود.',
    },
    {
      id: 'int_google_analytics',
      businessId,
      ownerId,
      provider: 'google_analytics',
      displayName: 'گوگل آنالیتیکس (GA4)',
      category: 'analytics',
      connectionStatus: 'not_connected',
      scopes: ['analytics.readonly'],
      statusNote: 'متصل نشده — گزارش‌ها فعلاً فقط بر اساس داده‌های داخلی ثبت‌شده محاسبه می‌شوند.',
    },
  ];

  for (const item of defaultIntegrations) {
    await setDoc(doc(db, 'businesses', businessId, 'integrations', item.id), {
      ...item,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const defaultAutomations: Array<Omit<Automation, 'createdAt' | 'updatedAt'>> = [
    {
      id: 'auto_new_idea_draft',
      businessId,
      ownerId,
      name: 'تبدیل ایده جدید به پیش‌نویس محتوا',
      description: 'هنگام ثبت یک ایده جدید، ایجنت محتوا پیش‌نویس اولیه را تولید و بدون انتشار خودکار ذخیره می‌کند.',
      triggerType: 'new_content_idea',
      actionSummary: 'اجرای ایجنت محتوا ← ذخیره پیش‌نویس در استودیو',
      enabled: true,
      requiresApprovalForExternal: true,
      runCount: 0,
      lastRunStatus: 'never',
    },
    {
      id: 'auto_weekly_review',
      businessId,
      ownerId,
      name: 'جمع‌بندی هفتگی عملکرد کسب‌وکار',
      description: 'بررسی محتواهای منتشرشده، فروش ثبت‌شده و وظایف ایجنت‌ها و ذخیره گزارش در بخش تحلیل‌ها.',
      triggerType: 'weekly_review',
      actionSummary: 'تحلیل آمار واقعی ← ذخیره گزارش هفتگی',
      enabled: true,
      requiresApprovalForExternal: true,
      runCount: 0,
      lastRunStatus: 'never',
    },
    {
      id: 'auto_low_activity',
      businessId,
      ownerId,
      name: 'پیشنهاد جبران وقفه تولید محتوا',
      description: 'در صورت کمبود پیش‌نویس در تقویم هفتگی، موضوعات تازه توسط ایجنت محتوا پیشنهاد می‌شود.',
      triggerType: 'low_content_activity',
      actionSummary: 'بررسی تقویم شمسی ← پیشنهاد موضوع جدید برای بررسی مالک',
      enabled: false,
      requiresApprovalForExternal: true,
      runCount: 0,
      lastRunStatus: 'never',
    },
  ];

  for (const auto of defaultAutomations) {
    await setDoc(doc(db, 'businesses', businessId, 'automations', auto.id), {
      ...auto,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function updateBusiness(
  businessId: string,
  patch: Partial<Business>
): Promise<void> {
  const path = `businesses/${businessId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    const allowedKeys: Array<keyof Business> = [
      'name',
      'creatorName',
      'slug',
      'category',
      'niche',
      'description',
      'website',
      'location',
      'primaryLanguage',
      'currency',
      'numeralStyle',
      'timezone',
      'onboardingStep',
      'onboardingStatus',
      'profileSummary',
      'profileConfirmed',
      'creatorProfile',
      'audienceProfile',
      'brandSettings',
      'businessGoals',
      'monetizationModels',
    ];
    for (const k of allowedKeys) {
      if (patch[k] !== undefined) {
        clean[k] = patch[k];
      }
    }
    await updateDoc(doc(db, 'businesses', businessId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// Real-time Subscriptions for Business Subcollections
// ============================================================================

export function subscribeBusinessSubcollection<T>(
  businessId: string,
  ownerId: string,
  subcollection: string,
  onData: (items: T[]) => void,
  maxItems = 100
): Unsubscribe {
  const path = `businesses/${businessId}/${subcollection}`;
  const q = query(
    collection(db, 'businesses', businessId, subcollection),
    where('ownerId', '==', ownerId),
    where('businessId', '==', businessId),
    orderBy('createdAt', 'desc'),
    limit(maxItems)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as T);
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// ============================================================================
// Activity Logs (Immutable Audit Trail)
// ============================================================================

export async function logActivity(
  businessId: string,
  ownerId: string,
  entry: Omit<ActivityLog, 'id' | 'businessId' | 'ownerId' | 'createdAt'>
): Promise<void> {
  const logId = makeId('log');
  const path = `businesses/${businessId}/activityLogs/${logId}`;
  try {
    const payload: ActivityLog = {
      id: logId,
      businessId,
      ownerId,
      actorType: entry.actorType,
      actorName: clampStr(entry.actorName, 120),
      action: clampStr(entry.action, 120),
      entityType: clampStr(entry.entityType, 64),
      entityId: clampStr(entry.entityId, 128),
      details: clampStr(entry.details, 600) || '-',
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'activityLogs', logId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// ============================================================================
// Agents & Tasks
// ============================================================================

export async function toggleAgentEnabled(
  businessId: string,
  ownerId: string,
  agent: Agent,
  enabled: boolean
): Promise<void> {
  const path = `businesses/${businessId}/agents/${agent.id}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId, 'agents', agent.id), {
      enabled,
      status: enabled ? 'idle' : 'disabled',
      updatedAt: serverTimestamp(),
    });
    await logActivity(businessId, ownerId, {
      actorType: 'owner',
      actorName: 'مالک کسب‌وکار',
      action: enabled ? 'فعال‌سازی ایجنت' : 'غیرفعال‌سازی ایجنت',
      entityType: 'agent',
      entityId: agent.id,
      details: `ایجنت «${agent.name}» ${enabled ? 'فعال' : 'غیرفعال'} شد.`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateAgentSettings(
  businessId: string,
  agentId: string,
  patch: { preferredTone?: string; outputLanguage?: 'fa' | 'en' | 'bilingual' }
): Promise<void> {
  const path = `businesses/${businessId}/agents/${agentId}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId, 'agents', agentId), {
      ...(patch.preferredTone !== undefined ? { preferredTone: clampStr(patch.preferredTone, 80) } : {}),
      ...(patch.outputLanguage !== undefined ? { outputLanguage: patch.outputLanguage } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createTaskRecord(
  businessId: string,
  ownerId: string,
  data: {
    agentId: string;
    agentType?: AgentType;
    title: string;
    description?: string;
    priority: Task['priority'];
    status: Task['status'];
    inputSummary?: string;
    requiresApproval: boolean;
  }
): Promise<string> {
  const taskId = makeId('task');
  const path = `businesses/${businessId}/tasks/${taskId}`;
  try {
    const task: Task = {
      id: taskId,
      businessId,
      ownerId,
      agentId: clampStr(data.agentId, 128),
      agentType: clampStr(data.agentType, 64),
      title: clampStr(data.title, 200) || 'وظیفه جدید',
      description: clampStr(data.description, 2000),
      priority: data.priority,
      status: data.status,
      inputSummary: clampStr(data.inputSummary, 3000),
      requiresApproval: data.requiresApproval,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'tasks', taskId), task);
    return taskId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateTaskResult(
  businessId: string,
  taskId: string,
  patch: Partial<
    Pick<
      Task,
      | 'status'
      | 'outputSummary'
      | 'outputStructured'
      | 'relatedEntityType'
      | 'relatedEntityId'
      | 'errorDetails'
      | 'inputTokens'
      | 'outputTokens'
      | 'estimatedCostUsd'
    >
  >
): Promise<void> {
  const path = `businesses/${businessId}/tasks/${taskId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.status !== undefined) clean.status = patch.status;
    if (patch.outputSummary !== undefined) clean.outputSummary = clampStr(patch.outputSummary, 12000);
    if (patch.outputStructured !== undefined) clean.outputStructured = patch.outputStructured;
    if (patch.relatedEntityType !== undefined) clean.relatedEntityType = clampStr(patch.relatedEntityType, 64);
    if (patch.relatedEntityId !== undefined) clean.relatedEntityId = clampStr(patch.relatedEntityId, 128);
    if (patch.errorDetails !== undefined) clean.errorDetails = clampStr(patch.errorDetails, 1000);
    if (patch.inputTokens !== undefined) clean.inputTokens = Math.max(0, Math.round(patch.inputTokens));
    if (patch.outputTokens !== undefined) clean.outputTokens = Math.max(0, Math.round(patch.outputTokens));
    if (patch.estimatedCostUsd !== undefined) clean.estimatedCostUsd = Math.max(0, patch.estimatedCostUsd);
    await updateDoc(doc(db, 'businesses', businessId, 'tasks', taskId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function recordAgentUsage(
  businessId: string,
  agent: Agent,
  tokensDelta: number,
  costDelta: number,
  completedDelta: number,
  status: Agent['status'] = 'idle'
): Promise<void> {
  const path = `businesses/${businessId}/agents/${agent.id}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId, 'agents', agent.id), {
      status,
      totalTokensUsed: (agent.totalTokensUsed ?? 0) + Math.max(0, Math.round(tokensDelta)),
      estimatedCostUsd: Number(((agent.estimatedCostUsd ?? 0) + Math.max(0, costDelta)).toFixed(6)),
      tasksCompleted: (agent.tasksCompleted ?? 0) + Math.max(0, completedDelta),
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// Approvals (Human-in-the-Loop Gate)
// ============================================================================

export async function createApprovalRequest(
  businessId: string,
  ownerId: string,
  params: {
    category: ApprovalCategory;
    actionTitle: string;
    requestingAgentId?: string;
    requestingAgentName?: string;
    targetPlatform?: string;
    reason?: string;
    payloadSummary: string;
    payloadData?: Record<string, unknown>;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }
): Promise<string> {
  const approvalId = makeId('appr');
  const path = `businesses/${businessId}/approvals/${approvalId}`;
  try {
    const payloadHash = await computePayloadHash({
      category: params.category,
      actionTitle: params.actionTitle,
      targetPlatform: params.targetPlatform ?? '',
      payloadSummary: params.payloadSummary,
      payloadData: params.payloadData ?? {},
    });
    const approval: Approval = {
      id: approvalId,
      businessId,
      ownerId,
      category: params.category,
      actionTitle: clampStr(params.actionTitle, 200),
      requestingAgentId: clampStr(params.requestingAgentId, 128),
      requestingAgentName: clampStr(params.requestingAgentName, 120),
      targetPlatform: clampStr(params.targetPlatform, 64),
      reason: clampStr(params.reason, 1000),
      payloadSummary: clampStr(params.payloadSummary, 12000),
      ...(params.payloadData ? { payloadData: params.payloadData } : {}),
      payloadHash,
      relatedEntityType: clampStr(params.relatedEntityType, 64),
      relatedEntityId: clampStr(params.relatedEntityId, 128),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'approvals', approvalId), approval);
    await logActivity(businessId, ownerId, {
      actorType: params.requestingAgentId ? 'agent' : 'owner',
      actorName: params.requestingAgentName || 'مالک کسب‌وکار',
      action: 'ثبت درخواست تأیید',
      entityType: 'approval',
      entityId: approvalId,
      details: `درخواست تأیید «${approval.actionTitle}» ثبت شد.`,
    });
    return approvalId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function resolveApprovalRequest(
  businessId: string,
  ownerId: string,
  approval: Approval,
  decision: 'approved' | 'rejected' | 'changes_requested',
  resolutionNote: string
): Promise<void> {
  const path = `businesses/${businessId}/approvals/${approval.id}`;
  try {
    let executionResult = '';
    if (decision === 'approved') {
      if (approval.relatedEntityType === 'content' && approval.relatedEntityId) {
        await updateContentItem(businessId, approval.relatedEntityId, {
          status: 'approved',
        });
        executionResult = 'محتوا تأیید شد و آماده انتشار دستی از طریق تقویم محتوا یا اتصال API رسمی است.';
      } else if (approval.relatedEntityType === 'campaign' && approval.relatedEntityId) {
        await updateCampaign(businessId, approval.relatedEntityId, {
          status: 'approved',
        });
        executionResult = 'کمپین توسط مالک تأیید شد.';
      } else if (
        approval.category === 'price_change' &&
        approval.relatedEntityType === 'product' &&
        approval.relatedEntityId &&
        typeof approval.payloadData?.newPrice === 'number'
      ) {
        await updateProduct(businessId, approval.relatedEntityId, {
          price: approval.payloadData.newPrice,
          pendingPrice: 0,
        });
        executionResult = 'تغییر قیمت محصول پس از تأیید مالک اعمال شد.';
      } else {
        executionResult = 'اقدام توسط مالک تأیید و در تاریخچه ممیزی ثبت شد.';
      }
    }

    await updateDoc(doc(db, 'businesses', businessId, 'approvals', approval.id), {
      status: decision,
      resolutionNote: clampStr(resolutionNote, 1000),
      approvedBy: ownerId,
      executionResult: clampStr(executionResult, 500),
      updatedAt: serverTimestamp(),
    });

    await logActivity(businessId, ownerId, {
      actorType: 'owner',
      actorName: 'مالک کسب‌وکار',
      action:
        decision === 'approved'
          ? 'تأیید اقدام'
          : decision === 'rejected'
          ? 'رد اقدام'
          : 'درخواست اصلاح اقدام',
      entityType: 'approval',
      entityId: approval.id,
      details: `${approval.actionTitle} — وضعیت: ${decision}${resolutionNote ? ` (${resolutionNote})` : ''}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// Content Studio & Social Planner
// ============================================================================

export async function createContentItem(
  businessId: string,
  ownerId: string,
  data: Omit<ContentItem, 'id' | 'businessId' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const contentId = makeId('cnt');
  const path = `businesses/${businessId}/content/${contentId}`;
  try {
    const item: ContentItem = {
      id: contentId,
      businessId,
      ownerId,
      title: clampStr(data.title, 200) || 'محتوای بدون عنوان',
      platform: data.platform,
      contentType: data.contentType,
      topic: clampStr(data.topic, 300),
      objective: clampStr(data.objective, 300),
      targetAudience: clampStr(data.targetAudience, 300),
      tone: clampStr(data.tone, 80),
      language: data.language || 'fa',
      caption: clampStr(data.caption, 10000),
      script: clampStr(data.script, 15000),
      cta: clampStr(data.cta, 300),
      hashtags: (data.hashtags ?? []).slice(0, 30).map((h) => clampStr(h, 60)).filter(Boolean),
      mediaIds: (data.mediaIds ?? []).slice(0, 15),
      ...(data.originalContentId ? { originalContentId: clampStr(data.originalContentId, 128) } : {}),
      status: data.status || 'draft',
      ...(data.scheduledDate ? { scheduledDate: clampStr(data.scheduledDate, 32) } : {}),
      ...(data.scheduledTime ? { scheduledTime: clampStr(data.scheduledTime, 16) } : {}),
      aiGenerated: Boolean(data.aiGenerated),
      ...(data.aiModel ? { aiModel: clampStr(data.aiModel, 80) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'content', contentId), item);
    await logActivity(businessId, ownerId, {
      actorType: data.aiGenerated ? 'agent' : 'owner',
      actorName: data.aiGenerated ? 'ایجنت محتوا' : 'مالک کسب‌وکار',
      action: 'ایجاد محتوا',
      entityType: 'content',
      entityId: contentId,
      details: `محتوای «${item.title}» برای ${item.platform} ذخیره شد.`,
    });
    return contentId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateContentItem(
  businessId: string,
  contentId: string,
  patch: Partial<ContentItem>
): Promise<void> {
  const path = `businesses/${businessId}/content/${contentId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.title !== undefined) clean.title = clampStr(patch.title, 200) || 'بدون عنوان';
    if (patch.platform !== undefined) clean.platform = patch.platform;
    if (patch.contentType !== undefined) clean.contentType = patch.contentType;
    if (patch.topic !== undefined) clean.topic = clampStr(patch.topic, 300);
    if (patch.objective !== undefined) clean.objective = clampStr(patch.objective, 300);
    if (patch.targetAudience !== undefined) clean.targetAudience = clampStr(patch.targetAudience, 300);
    if (patch.tone !== undefined) clean.tone = clampStr(patch.tone, 80);
    if (patch.language !== undefined) clean.language = patch.language;
    if (patch.caption !== undefined) clean.caption = clampStr(patch.caption, 10000);
    if (patch.script !== undefined) clean.script = clampStr(patch.script, 15000);
    if (patch.cta !== undefined) clean.cta = clampStr(patch.cta, 300);
    if (patch.hashtags !== undefined) {
      clean.hashtags = patch.hashtags.slice(0, 30).map((h) => clampStr(h, 60)).filter(Boolean);
    }
    if (patch.mediaIds !== undefined) clean.mediaIds = patch.mediaIds.slice(0, 15);
    if (patch.status !== undefined) clean.status = patch.status;
    if (patch.scheduledDate !== undefined) clean.scheduledDate = clampStr(patch.scheduledDate, 32);
    if (patch.scheduledTime !== undefined) clean.scheduledTime = clampStr(patch.scheduledTime, 16);
    if (patch.publishedAtLabel !== undefined) clean.publishedAtLabel = clampStr(patch.publishedAtLabel, 64);
    await updateDoc(doc(db, 'businesses', businessId, 'content', contentId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteContentItem(businessId: string, contentId: string): Promise<void> {
  const path = `businesses/${businessId}/content/${contentId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId, 'content', contentId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// Media Library
// ============================================================================

export async function createMediaAsset(
  businessId: string,
  ownerId: string,
  data: Omit<MediaAsset, 'id' | 'businessId' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const mediaId = makeId('med');
  const path = `businesses/${businessId}/mediaAssets/${mediaId}`;
  try {
    const asset: MediaAsset = {
      id: mediaId,
      businessId,
      ownerId,
      fileName: clampStr(data.fileName, 200) || 'فایل رسانه',
      category: data.category,
      mimeType: clampStr(data.mimeType, 100) || 'application/octet-stream',
      fileSize: Math.max(0, Math.round(data.fileSize)),
      ...(data.previewUrl ? { previewUrl: data.previewUrl.slice(0, 350000) } : {}),
      storagePath: clampStr(data.storagePath || `businesses/${businessId}/media/${mediaId}`, 500),
      relatedContentIds: (data.relatedContentIds ?? []).slice(0, 50),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'mediaAssets', mediaId), asset);
    return mediaId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateMediaAsset(
  businessId: string,
  mediaId: string,
  patch: Partial<Pick<MediaAsset, 'fileName' | 'category' | 'relatedContentIds'>>
): Promise<void> {
  const path = `businesses/${businessId}/mediaAssets/${mediaId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.fileName !== undefined) clean.fileName = clampStr(patch.fileName, 200);
    if (patch.category !== undefined) clean.category = patch.category;
    if (patch.relatedContentIds !== undefined) clean.relatedContentIds = patch.relatedContentIds.slice(0, 50);
    await updateDoc(doc(db, 'businesses', businessId, 'mediaAssets', mediaId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteMediaAsset(businessId: string, mediaId: string): Promise<void> {
  const path = `businesses/${businessId}/mediaAssets/${mediaId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId, 'mediaAssets', mediaId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// CRM Contacts
// ============================================================================

export async function createContact(
  businessId: string,
  ownerId: string,
  data: Omit<Contact, 'id' | 'businessId' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const contactId = makeId('cntc');
  const path = `businesses/${businessId}/contacts/${contactId}`;
  try {
    const contact: Contact = {
      id: contactId,
      businessId,
      ownerId,
      fullName: clampStr(data.fullName, 140),
      email: clampStr(data.email, 254),
      phone: clampStr(data.phone, 32),
      socialPlatform: clampStr(data.socialPlatform, 50),
      socialUsername: clampStr(data.socialUsername, 100),
      source: clampStr(data.source, 100),
      contactType: data.contactType,
      pipelineStage: data.pipelineStage,
      tags: (data.tags ?? []).slice(0, 25).map((t) => clampStr(t, 40)).filter(Boolean),
      notes: clampStr(data.notes, 3000),
      consentStatus: data.consentStatus,
      totalSpent: Math.max(0, data.totalSpent ?? 0),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'contacts', contactId), contact);
    await logActivity(businessId, ownerId, {
      actorType: 'owner',
      actorName: 'مالک کسب‌وکار',
      action: 'افزودن مخاطب به CRM',
      entityType: 'contact',
      entityId: contactId,
      details: `مخاطب «${contact.fullName}» ثبت شد.`,
    });
    return contactId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateContact(
  businessId: string,
  contactId: string,
  patch: Partial<Contact>
): Promise<void> {
  const path = `businesses/${businessId}/contacts/${contactId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.fullName !== undefined) clean.fullName = clampStr(patch.fullName, 140);
    if (patch.email !== undefined) clean.email = clampStr(patch.email, 254);
    if (patch.phone !== undefined) clean.phone = clampStr(patch.phone, 32);
    if (patch.socialPlatform !== undefined) clean.socialPlatform = clampStr(patch.socialPlatform, 50);
    if (patch.socialUsername !== undefined) clean.socialUsername = clampStr(patch.socialUsername, 100);
    if (patch.source !== undefined) clean.source = clampStr(patch.source, 100);
    if (patch.contactType !== undefined) clean.contactType = patch.contactType;
    if (patch.pipelineStage !== undefined) clean.pipelineStage = patch.pipelineStage;
    if (patch.tags !== undefined) clean.tags = patch.tags.slice(0, 25).map((t) => clampStr(t, 40)).filter(Boolean);
    if (patch.notes !== undefined) clean.notes = clampStr(patch.notes, 3000);
    if (patch.consentStatus !== undefined) clean.consentStatus = patch.consentStatus;
    if (patch.totalSpent !== undefined) clean.totalSpent = Math.max(0, patch.totalSpent);
    await updateDoc(doc(db, 'businesses', businessId, 'contacts', contactId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteContact(businessId: string, contactId: string): Promise<void> {
  const path = `businesses/${businessId}/contacts/${contactId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId, 'contacts', contactId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// Products & Orders
// ============================================================================

export async function createProduct(
  businessId: string,
  ownerId: string,
  data: Omit<Product, 'id' | 'businessId' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const productId = makeId('prod');
  const path = `businesses/${businessId}/products/${productId}`;
  try {
    const product: Product = {
      id: productId,
      businessId,
      ownerId,
      name: clampStr(data.name, 160),
      description: clampStr(data.description, 4000),
      productType: data.productType,
      price: Math.max(0, data.price),
      pendingPrice: 0,
      currency: data.currency,
      deliveryNote: clampStr(data.deliveryNote, 500),
      productUrl: clampStr(data.productUrl, 300),
      status: data.status,
      salesCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'products', productId), product);
    await logActivity(businessId, ownerId, {
      actorType: 'owner',
      actorName: 'مالک کسب‌وکار',
      action: 'ایجاد محصول جدید',
      entityType: 'product',
      entityId: productId,
      details: `محصول «${product.name}» ایجاد شد.`,
    });
    return productId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateProduct(
  businessId: string,
  productId: string,
  patch: Partial<Product>
): Promise<void> {
  const path = `businesses/${businessId}/products/${productId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.name !== undefined) clean.name = clampStr(patch.name, 160);
    if (patch.description !== undefined) clean.description = clampStr(patch.description, 4000);
    if (patch.productType !== undefined) clean.productType = patch.productType;
    if (patch.price !== undefined) clean.price = Math.max(0, patch.price);
    if (patch.pendingPrice !== undefined) clean.pendingPrice = Math.max(0, patch.pendingPrice);
    if (patch.currency !== undefined) clean.currency = patch.currency;
    if (patch.deliveryNote !== undefined) clean.deliveryNote = clampStr(patch.deliveryNote, 500);
    if (patch.productUrl !== undefined) clean.productUrl = clampStr(patch.productUrl, 300);
    if (patch.status !== undefined) clean.status = patch.status;
    if (patch.salesCount !== undefined) clean.salesCount = Math.max(0, Math.round(patch.salesCount));
    await updateDoc(doc(db, 'businesses', businessId, 'products', productId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteProduct(businessId: string, productId: string): Promise<void> {
  const path = `businesses/${businessId}/products/${productId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId, 'products', productId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function createOrderWithIdempotency(
  businessId: string,
  ownerId: string,
  data: {
    idempotencyKey: string;
    product: Product;
    customerName: string;
    customerEmail: string;
    paymentProvider: string;
    paymentStatus: Order['paymentStatus'];
  }
): Promise<string> {
  const safeId = `ord_${data.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)}`;
  const path = `businesses/${businessId}/orders/${safeId}`;
  try {
    const existingSnap = await getDoc(doc(db, 'businesses', businessId, 'orders', safeId));
    if (existingSnap.exists()) {
      return safeId;
    }
    const order: Order = {
      id: safeId,
      businessId,
      ownerId,
      orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
      customerName: clampStr(data.customerName, 140),
      customerEmail: clampStr(data.customerEmail, 254),
      productId: data.product.id,
      productName: clampStr(data.product.name, 160),
      total: Math.max(0, data.product.price),
      currency: data.product.currency,
      paymentProvider: clampStr(data.paymentProvider, 64),
      paymentReference: clampStr(data.idempotencyKey, 128),
      paymentStatus: data.paymentStatus,
      fulfillmentStatus: data.paymentStatus === 'paid' ? 'delivered' : 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'orders', safeId), order);
    if (data.paymentStatus === 'paid') {
      await updateProduct(businessId, data.product.id, {
        salesCount: (data.product.salesCount ?? 0) + 1,
      });
    }
    await logActivity(businessId, ownerId, {
      actorType: 'system',
      actorName: 'سیستم سفارشات',
      action: 'ثبت سفارش جدید',
      entityType: 'order',
      entityId: safeId,
      details: `سفارش ${order.orderNumber} برای «${data.product.name}» با وضعیت ${data.paymentStatus} ثبت شد.`,
    });
    return safeId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// ============================================================================
// Campaigns, Automations, Business Memory, Integrations, Reports, AI Chats
// ============================================================================

export async function createCampaign(
  businessId: string,
  ownerId: string,
  data: Omit<Campaign, 'id' | 'businessId' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeId('cmp');
  const path = `businesses/${businessId}/campaigns/${id}`;
  try {
    const campaign: Campaign = {
      id,
      businessId,
      ownerId,
      name: clampStr(data.name, 160),
      campaignType: data.campaignType,
      objective: clampStr(data.objective, 1000),
      targetAudience: clampStr(data.targetAudience, 400),
      platforms: (data.platforms ?? []).slice(0, 10),
      relatedProductId: clampStr(data.relatedProductId, 128),
      budget: Math.max(0, data.budget ?? 0),
      currency: data.currency || 'IRT',
      startDate: clampStr(data.startDate, 32),
      endDate: clampStr(data.endDate, 32),
      status: data.status || 'draft',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'campaigns', id), campaign);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateCampaign(
  businessId: string,
  campaignId: string,
  patch: Partial<Campaign>
): Promise<void> {
  const path = `businesses/${businessId}/campaigns/${campaignId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.name !== undefined) clean.name = clampStr(patch.name, 160);
    if (patch.campaignType !== undefined) clean.campaignType = patch.campaignType;
    if (patch.objective !== undefined) clean.objective = clampStr(patch.objective, 1000);
    if (patch.targetAudience !== undefined) clean.targetAudience = clampStr(patch.targetAudience, 400);
    if (patch.platforms !== undefined) clean.platforms = patch.platforms.slice(0, 10);
    if (patch.relatedProductId !== undefined) clean.relatedProductId = clampStr(patch.relatedProductId, 128);
    if (patch.budget !== undefined) clean.budget = Math.max(0, patch.budget);
    if (patch.currency !== undefined) clean.currency = patch.currency;
    if (patch.startDate !== undefined) clean.startDate = clampStr(patch.startDate, 32);
    if (patch.endDate !== undefined) clean.endDate = clampStr(patch.endDate, 32);
    if (patch.status !== undefined) clean.status = patch.status;
    await updateDoc(doc(db, 'businesses', businessId, 'campaigns', campaignId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteCampaign(businessId: string, campaignId: string): Promise<void> {
  const path = `businesses/${businessId}/campaigns/${campaignId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId, 'campaigns', campaignId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function createAutomation(
  businessId: string,
  ownerId: string,
  data: Omit<Automation, 'id' | 'businessId' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeId('auto');
  const path = `businesses/${businessId}/automations/${id}`;
  try {
    const auto: Automation = {
      id,
      businessId,
      ownerId,
      name: clampStr(data.name, 160),
      description: clampStr(data.description, 1000),
      triggerType: data.triggerType,
      actionSummary: clampStr(data.actionSummary, 500),
      enabled: Boolean(data.enabled),
      requiresApprovalForExternal: true,
      runCount: 0,
      lastRunStatus: 'never',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'automations', id), auto);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateAutomation(
  businessId: string,
  automationId: string,
  patch: Partial<Automation>
): Promise<void> {
  const path = `businesses/${businessId}/automations/${automationId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.name !== undefined) clean.name = clampStr(patch.name, 160);
    if (patch.description !== undefined) clean.description = clampStr(patch.description, 1000);
    if (patch.triggerType !== undefined) clean.triggerType = patch.triggerType;
    if (patch.actionSummary !== undefined) clean.actionSummary = clampStr(patch.actionSummary, 500);
    if (patch.enabled !== undefined) clean.enabled = patch.enabled;
    if (patch.runCount !== undefined) clean.runCount = Math.max(0, Math.round(patch.runCount));
    if (patch.lastRunStatus !== undefined) clean.lastRunStatus = patch.lastRunStatus;
    if (patch.lastExecutedAt !== undefined) clean.lastExecutedAt = clampStr(patch.lastExecutedAt, 64);
    await updateDoc(doc(db, 'businesses', businessId, 'automations', automationId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteAutomation(businessId: string, automationId: string): Promise<void> {
  const path = `businesses/${businessId}/automations/${automationId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId, 'automations', automationId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function recordAutomationRun(
  businessId: string,
  ownerId: string,
  automation: Automation,
  status: 'success' | 'failed',
  outputSummary: string,
  error?: string
): Promise<void> {
  const runId = makeId('run');
  const path = `businesses/${businessId}/automationRuns/${runId}`;
  try {
    const run: AutomationRun = {
      id: runId,
      businessId,
      ownerId,
      automationId: automation.id,
      automationName: clampStr(automation.name, 160),
      status,
      outputSummary: clampStr(outputSummary, 2000),
      ...(error ? { error: clampStr(error, 1000) } : {}),
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'automationRuns', runId), run);
    await updateAutomation(businessId, automation.id, {
      runCount: (automation.runCount ?? 0) + 1,
      lastRunStatus: status,
      lastExecutedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createMemoryItem(
  businessId: string,
  ownerId: string,
  data: Omit<BusinessMemoryItem, 'id' | 'businessId' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeId('mem');
  const path = `businesses/${businessId}/businessMemory/${id}`;
  try {
    const item: BusinessMemoryItem = {
      id,
      businessId,
      ownerId,
      category: data.category,
      title: clampStr(data.title, 180),
      content: clampStr(data.content, 4000),
      sourceType: data.sourceType,
      verifiedByOwner: Boolean(data.verifiedByOwner),
      confidence: data.confidence ?? (data.verifiedByOwner ? 1 : 0.75),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'businessMemory', id), item);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateMemoryItem(
  businessId: string,
  memoryId: string,
  patch: Partial<BusinessMemoryItem>
): Promise<void> {
  const path = `businesses/${businessId}/businessMemory/${memoryId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.category !== undefined) clean.category = patch.category;
    if (patch.title !== undefined) clean.title = clampStr(patch.title, 180);
    if (patch.content !== undefined) clean.content = clampStr(patch.content, 4000);
    if (patch.sourceType !== undefined) clean.sourceType = patch.sourceType;
    if (patch.verifiedByOwner !== undefined) clean.verifiedByOwner = patch.verifiedByOwner;
    if (patch.confidence !== undefined) clean.confidence = patch.confidence;
    await updateDoc(doc(db, 'businesses', businessId, 'businessMemory', memoryId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteMemoryItem(businessId: string, memoryId: string): Promise<void> {
  const path = `businesses/${businessId}/businessMemory/${memoryId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId, 'businessMemory', memoryId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function updateIntegrationStatus(
  businessId: string,
  integrationId: string,
  patch: Partial<Pick<Integration, 'connectionStatus' | 'accountHandle' | 'statusNote'>>
): Promise<void> {
  const path = `businesses/${businessId}/integrations/${integrationId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.connectionStatus !== undefined) clean.connectionStatus = patch.connectionStatus;
    if (patch.accountHandle !== undefined) clean.accountHandle = clampStr(patch.accountHandle, 120);
    if (patch.statusNote !== undefined) clean.statusNote = clampStr(patch.statusNote, 500);
    await updateDoc(doc(db, 'businesses', businessId, 'integrations', integrationId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function saveAnalyticsReport(
  businessId: string,
  ownerId: string,
  data: Omit<AnalyticsReport, 'id' | 'businessId' | 'ownerId' | 'createdAt'>
): Promise<string> {
  const id = makeId('rep');
  const path = `businesses/${businessId}/analyticsReports/${id}`;
  try {
    const report: AnalyticsReport = {
      id,
      businessId,
      ownerId,
      reportType: data.reportType,
      title: clampStr(data.title, 200),
      summary: clampStr(data.summary, 12000),
      dataSourceNote: clampStr(data.dataSourceNote, 500),
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'analyticsReports', id), report);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function saveAiChatMessage(
  businessId: string,
  ownerId: string,
  data: { role: 'user' | 'assistant'; content: string; createdTaskId?: string }
): Promise<string> {
  const id = makeId('msg');
  const path = `businesses/${businessId}/aiChats/${id}`;
  try {
    const msg: AiChatMessage = {
      id,
      businessId,
      ownerId,
      role: data.role,
      content: clampStr(data.content, 12000),
      ...(data.createdTaskId ? { createdTaskId: clampStr(data.createdTaskId, 128) } : {}),
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'businesses', businessId, 'aiChats', id), msg);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
