export type LocaleCode = 'fa' | 'en';
export type NumeralStyle = 'persian' | 'latin';
export type CurrencyCode = 'IRT' | 'IRR' | 'USD';

export type AgentType =
  | 'chief_manager'
  | 'content'
  | 'research_growth'
  | 'sales_monetization'
  | 'customer_relationship';

export type AgentStatus =
  | 'active'
  | 'idle'
  | 'working'
  | 'waiting_input'
  | 'waiting_approval'
  | 'failed'
  | 'disabled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskStatus =
  | 'created'
  | 'assigned'
  | 'in_progress'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ApprovalCategory =
  | 'content_publication'
  | 'social_message'
  | 'marketing_email'
  | 'price_change'
  | 'campaign_launch'
  | 'customer_reply'
  | 'external_integration'
  | 'other';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'expired';

export type SocialPlatform =
  | 'instagram'
  | 'telegram'
  | 'youtube'
  | 'tiktok'
  | 'linkedin'
  | 'x'
  | 'newsletter';

export type ContentType =
  | 'post'
  | 'carousel'
  | 'reel_script'
  | 'short_script'
  | 'video_description'
  | 'story'
  | 'thread'
  | 'newsletter';

export type ContentStatus =
  | 'idea'
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'archived';

export type MediaCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'logo'
  | 'brand_asset'
  | 'thumbnail'
  | 'document';

export type ContactType =
  | 'audience_member'
  | 'lead'
  | 'customer'
  | 'partner'
  | 'brand_contact';

export type PipelineStage =
  | 'new'
  | 'interested'
  | 'qualified'
  | 'customer'
  | 'inactive'
  | 'archived';

export type ConsentStatus = 'subscribed' | 'unsubscribed' | 'pending';

export type ProductType =
  | 'digital_download'
  | 'ebook'
  | 'template'
  | 'online_course'
  | 'consulting'
  | 'coaching'
  | 'membership';

export type ProductStatus = 'draft' | 'active' | 'inactive' | 'archived';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type FulfillmentStatus = 'pending' | 'delivered' | 'failed';

export type CampaignType =
  | 'product_promotion'
  | 'audience_growth'
  | 'content_launch'
  | 'affiliate'
  | 'brand_partnership'
  | 'retention';

export type CampaignStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type AutomationTriggerType =
  | 'new_content_idea'
  | 'new_order'
  | 'weekly_review'
  | 'low_content_activity'
  | 'manual';

export type MemoryCategory =
  | 'business_profile'
  | 'brand_identity'
  | 'audience_profile'
  | 'products'
  | 'content_history'
  | 'customer_insights'
  | 'business_goals'
  | 'decisions'
  | 'campaign_history'
  | 'performance_insights';

export type MemorySourceType = 'owner_confirmed' | 'ai_inferred' | 'analytics_derived';

export type IntegrationProvider =
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'linkedin'
  | 'telegram'
  | 'zarinpal'
  | 'stripe'
  | 'email'
  | 'google_analytics';

export type IntegrationStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'permission_required'
  | 'error'
  | 'disconnected';

export type ReportType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'content_performance'
  | 'business_performance';

export type NavSection =
  | 'overview'
  | 'workforce'
  | 'content'
  | 'planner'
  | 'media'
  | 'crm'
  | 'products'
  | 'campaigns'
  | 'analytics'
  | 'automations'
  | 'approvals'
  | 'memory'
  | 'integrations'
  | 'settings';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  preferredLocale: LocaleCode;
  preferredNumerals?: NumeralStyle;
  preferredCurrency?: CurrencyCode;
  activeBusinessId?: string;
  status: 'active' | 'suspended';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CreatorProfileData {
  mainPlatforms: string[];
  experienceLevel: string;
  expertiseTopics: string;
  preferredFormats: string[];
}

export interface AudienceProfileData {
  description: string;
  ageRange: string;
  location: string;
  interests: string;
  painPoints: string;
  goals: string;
  preferredLanguage: string;
}

export interface BrandSettingsData {
  voice: string;
  communicationStyle: string;
  personality: string;
  preferredTerms: string;
  avoidWords: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface BusinessGoalsData {
  audienceGoal: string;
  publishingCadence: string;
  engagementGoal: string;
  revenueGoal: string;
  primaryObjective: string;
}

export interface Business {
  id: string;
  ownerId: string;
  name: string;
  creatorName?: string;
  slug: string;
  category?: string;
  niche?: string;
  description?: string;
  website?: string;
  location?: string;
  primaryLanguage: 'fa' | 'en' | 'ar';
  currency: CurrencyCode;
  numeralStyle?: NumeralStyle;
  timezone?: string;
  onboardingStep?: number;
  onboardingStatus: 'in_progress' | 'completed';
  profileSummary?: string;
  profileConfirmed?: boolean;
  creatorProfile?: CreatorProfileData;
  audienceProfile?: AudienceProfileData;
  brandSettings?: BrandSettingsData;
  businessGoals?: BusinessGoalsData;
  monetizationModels?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Agent {
  id: string;
  businessId: string;
  ownerId: string;
  agentType: AgentType;
  name: string;
  role: string;
  description?: string;
  status: AgentStatus;
  enabled: boolean;
  responsibilities?: string[];
  allowedTools?: string[];
  preferredTone?: string;
  outputLanguage?: 'fa' | 'en' | 'bilingual';
  totalTokensUsed?: number;
  estimatedCostUsd?: number;
  tasksCompleted?: number;
  lastActivityAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Task {
  id: string;
  businessId: string;
  ownerId: string;
  agentId: string;
  agentType?: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  inputSummary?: string;
  outputSummary?: string;
  outputStructured?: Record<string, unknown>;
  relatedEntityType?: string;
  relatedEntityId?: string;
  requiresApproval: boolean;
  errorDetails?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Approval {
  id: string;
  businessId: string;
  ownerId: string;
  category: ApprovalCategory;
  actionTitle: string;
  requestingAgentId?: string;
  requestingAgentName?: string;
  targetPlatform?: string;
  reason?: string;
  payloadSummary?: string;
  payloadData?: Record<string, unknown>;
  payloadHash: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  status: ApprovalStatus;
  resolutionNote?: string;
  approvedBy?: string;
  executionResult?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ContentItem {
  id: string;
  businessId: string;
  ownerId: string;
  title: string;
  platform: SocialPlatform;
  contentType: ContentType;
  topic?: string;
  objective?: string;
  targetAudience?: string;
  tone?: string;
  language: 'fa' | 'en' | 'ar';
  caption?: string;
  script?: string;
  cta?: string;
  hashtags?: string[];
  mediaIds?: string[];
  originalContentId?: string;
  status: ContentStatus;
  scheduledDate?: string; // ISO YYYY-MM-DD
  scheduledTime?: string;
  publishedAtLabel?: string;
  aiGenerated: boolean;
  aiModel?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MediaAsset {
  id: string;
  businessId: string;
  ownerId: string;
  fileName: string;
  category: MediaCategory;
  mimeType: string;
  fileSize: number;
  previewUrl?: string;
  storagePath?: string;
  relatedContentIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Contact {
  id: string;
  businessId: string;
  ownerId: string;
  fullName: string;
  email?: string;
  phone?: string;
  socialPlatform?: string;
  socialUsername?: string;
  source?: string;
  contactType: ContactType;
  pipelineStage: PipelineStage;
  tags?: string[];
  notes?: string;
  consentStatus: ConsentStatus;
  totalSpent?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Product {
  id: string;
  businessId: string;
  ownerId: string;
  name: string;
  description?: string;
  productType: ProductType;
  price: number;
  pendingPrice?: number;
  currency: CurrencyCode;
  deliveryNote?: string;
  productUrl?: string;
  status: ProductStatus;
  salesCount?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Order {
  id: string;
  businessId: string;
  ownerId: string;
  orderNumber: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  productId: string;
  productName?: string;
  total: number;
  currency: CurrencyCode;
  paymentProvider?: string;
  paymentReference?: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Campaign {
  id: string;
  businessId: string;
  ownerId: string;
  name: string;
  campaignType: CampaignType;
  objective?: string;
  targetAudience?: string;
  platforms?: string[];
  relatedProductId?: string;
  budget?: number;
  currency?: CurrencyCode;
  startDate?: string;
  endDate?: string;
  status: CampaignStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Automation {
  id: string;
  businessId: string;
  ownerId: string;
  name: string;
  description?: string;
  triggerType: AutomationTriggerType;
  actionSummary?: string;
  enabled: boolean;
  requiresApprovalForExternal: boolean;
  runCount?: number;
  lastRunStatus?: 'never' | 'success' | 'failed';
  lastExecutedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AutomationRun {
  id: string;
  businessId: string;
  ownerId: string;
  automationId: string;
  automationName?: string;
  status: 'running' | 'success' | 'failed';
  outputSummary?: string;
  error?: string;
  createdAt?: unknown;
}

export interface BusinessMemoryItem {
  id: string;
  businessId: string;
  ownerId: string;
  category: MemoryCategory;
  title: string;
  content: string;
  sourceType: MemorySourceType;
  verifiedByOwner: boolean;
  confidence?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ActivityLog {
  id: string;
  businessId: string;
  ownerId: string;
  actorType: 'owner' | 'agent' | 'system';
  actorName?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details: string;
  createdAt?: unknown;
}

export interface Integration {
  id: string;
  businessId: string;
  ownerId: string;
  provider: IntegrationProvider;
  displayName?: string;
  category?: 'social' | 'payment' | 'messaging' | 'analytics';
  connectionStatus: IntegrationStatus;
  accountHandle?: string;
  scopes?: string[];
  statusNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AnalyticsReport {
  id: string;
  businessId: string;
  ownerId: string;
  reportType: ReportType;
  title: string;
  summary: string;
  dataSourceNote?: string;
  createdAt?: unknown;
}

export interface AiChatMessage {
  id: string;
  businessId: string;
  ownerId: string;
  role: 'user' | 'assistant';
  content: string;
  createdTaskId?: string;
  createdAt?: unknown;
}
