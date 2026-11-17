import type { LocaleCode } from '../types/domain';

export interface TranslationDictionary {
  brand: {
    name: string;
    edition: string;
    tagline: string;
  };
  nav: {
    overview: string;
    workforce: string;
    content: string;
    planner: string;
    media: string;
    crm: string;
    products: string;
    campaigns: string;
    analytics: string;
    automations: string;
    approvals: string;
    memory: string;
    integrations: string;
    settings: string;
  };
  common: {
    save: string;
    cancel: string;
    delete: string;
    confirmDelete: string;
    edit: string;
    create: string;
    add: string;
    search: string;
    filter: string;
    all: string;
    loading: string;
    retry: string;
    close: string;
    back: string;
    next: string;
    finish: string;
    copy: string;
    copied: string;
    download: string;
    status: string;
    actions: string;
    date: string;
    source: string;
    unavailable: string;
    notConnected: string;
    estimated: string;
    confirmedFact: string;
    aiAssumption: string;
    aiGenerated: string;
    noData: string;
    signOut: string;
    openAiManager: string;
    saveSuccess: string;
    errorOccurred: string;
  };
  auth: {
    welcomeTitle: string;
    welcomeSubtitle: string;
    googleButton: string;
    privacyNote: string;
    humanControlPoint1: string;
    humanControlPoint2: string;
    humanControlPoint3: string;
    authError: string;
  };
  onboarding: {
    title: string;
    subtitle: string;
    resumeBanner: string;
    stepOf: string;
    steps: {
      identity: string;
      creator: string;
      audience: string;
      brand: string;
      goals: string;
      monetization: string;
      review: string;
    };
    generateSummaryBtn: string;
    confirmAndLaunchBtn: string;
    saveProgressBtn: string;
  };
  statuses: {
    active: string;
    idle: string;
    working: string;
    waiting_input: string;
    waiting_approval: string;
    failed: string;
    disabled: string;
    pending: string;
    approved: string;
    rejected: string;
    changes_requested: string;
    expired: string;
    idea: string;
    draft: string;
    in_review: string;
    scheduled: string;
    published: string;
    archived: string;
    completed: string;
    cancelled: string;
    in_progress: string;
    created: string;
    assigned: string;
    awaiting_input: string;
    awaiting_approval: string;
    paused: string;
  };
  platforms: {
    instagram: string;
    telegram: string;
    youtube: string;
    tiktok: string;
    linkedin: string;
    x: string;
    newsletter: string;
  };
  contentTypes: {
    post: string;
    carousel: string;
    reel_script: string;
    short_script: string;
    video_description: string;
    story: string;
    thread: string;
    newsletter: string;
  };
}

export interface I18nContextValue {
  locale: LocaleCode;
  dir: 'rtl' | 'ltr';
  t: TranslationDictionary;
  setLocale: (locale: LocaleCode) => void;
}
