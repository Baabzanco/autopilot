import { getAuthIdToken } from '../lib/firebase';
import type {
  AgentType,
  AiCapability,
  AiConnectionStatus,
  AiModelSpecView,
  AiPlatformCredentialPolicy,
  AiProviderId,
  AiProviderView,
  AiRequestLogView,
  AiRoutingPolicyView,
  AiTelemetrySummaryView,
  Business,
  BusinessAiSettingsView,
  ContentItem,
  ContentType,
  ImageAspectRatio,
  ImageGenerationJobView,
  Product,
  ReportType,
  SocialPlatform,
  StoredMediaAssetView,
  VisualFormatKey,
} from '../types/domain';

async function requestApi<TResponse>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<TResponse> {
  const token = await getAuthIdToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `خطای سرور (${res.status})`);
  }
  return json as TResponse;
}

function postApi<TResponse>(path: string, body: unknown): Promise<TResponse> {
  return requestApi<TResponse>('POST', path, body);
}

export interface OnboardingSummaryResponse {
  summary: string;
  keyOpportunities: string[];
  recommendedFirstWeekPlan: string[];
  tokensUsed: number;
  estimatedCostUsd: number;
}

export function generateOnboardingSummary(business: Business) {
  return postApi<OnboardingSummaryResponse>('/api/v1/ai/onboarding-summary', { business });
}

export interface ManagerChatResponse {
  reply: string;
  factsUsed: string[];
  assumptionsAndRecommendations: string[];
  suggestedTaskTitle: string;
  recommendedAgentType: AgentType;
  requiresApproval: boolean;
  tokens: { input: number; output: number; estimatedCostUsd: number };
}

export function sendManagerChat(params: {
  message: string;
  business: Business;
  metricsSnapshot: Record<string, unknown>;
  memoryItems: Array<{ title: string; content: string; verifiedByOwner: boolean }>;
  recentTasks: Array<{ title: string; status: string; agentType?: string }>;
}) {
  return postApi<ManagerChatResponse>('/api/v1/ai/manager/chat', params);
}

export interface AgentExecuteResponse {
  summary: string;
  deliverables: Array<{ title: string; detail: string }>;
  requiresApproval: boolean;
  approvalCategory?: string;
  approvalReason?: string;
  dataLimitations?: string;
  tokens: { input: number; output: number; estimatedCostUsd: number };
}

export function executeSpecialistAgent(params: {
  agentType: AgentType;
  agentName: string;
  prompt: string;
  preferredTone?: string;
  outputLanguage?: string;
  business: Business;
  contextSnapshot: Record<string, unknown>;
}) {
  return postApi<AgentExecuteResponse>('/api/v1/ai/agents/execute', params);
}

export interface ContentGenerateResponse {
  title: string;
  caption: string;
  script: string;
  cta: string;
  hashtags: string[];
  slides: string[];
  tokens: { input: number; output: number; estimatedCostUsd: number };
  modelUsed?: string;
}

export function generateContentDraft(params: {
  mode: 'idea' | 'topic' | 'url' | 'improve';
  promptInput: string;
  platform: SocialPlatform;
  contentType: ContentType;
  objective: string;
  tone: string;
  language: 'fa' | 'en' | 'ar';
  business: Business;
}) {
  return postApi<ContentGenerateResponse>('/api/v1/ai/content/generate', params);
}

export interface ContentRepurposeResponse {
  versions: Array<{
    platform: SocialPlatform;
    contentType: ContentType;
    title: string;
    caption: string;
    script: string;
    cta: string;
    hashtags: string[];
  }>;
  tokens: { input: number; output: number; estimatedCostUsd: number };
  modelUsed?: string;
}

export function repurposeContentDraft(params: {
  original: ContentItem;
  targetPlatforms: SocialPlatform[];
  business: Business;
}) {
  return postApi<ContentRepurposeResponse>('/api/v1/ai/content/repurpose', params);
}

export interface CampaignDraftResponse {
  name: string;
  objective: string;
  targetAudience: string;
  keyMessages: string[];
  launchChecklist: string[];
  tokens: { input: number; output: number; estimatedCostUsd: number };
}

export function generateCampaignDraft(params: {
  goalPrompt: string;
  campaignType: string;
  product?: Product;
  business: Business;
}) {
  return postApi<CampaignDraftResponse>('/api/v1/ai/campaigns/draft', params);
}

export interface AnalyticsReportResponse {
  title: string;
  summary: string;
  dataSourceNote: string;
  tokens: { input: number; output: number; estimatedCostUsd: number };
}

export function generateAnalyticsReport(params: {
  reportType: ReportType;
  business: Business;
  metricsSnapshot: Record<string, unknown>;
}) {
  return postApi<AnalyticsReportResponse>('/api/v1/ai/analytics/report', params);
}

export interface CrmReplyDraftResponse {
  subject: string;
  replyDraft: string;
  toneNote: string;
  tokens: { input: number; output: number; estimatedCostUsd: number };
}

export function draftCrmCustomerReply(params: {
  customerName: string;
  inquiry: string;
  business: Business;
}) {
  return postApi<CrmReplyDraftResponse>('/api/v1/ai/crm/draft-reply', params);
}

export interface ApprovalExecutionVerificationResponse {
  verified: boolean;
  hashValid?: boolean;
  computedHash?: string;
  canExecuteExternally: boolean;
  status: 'ready_for_connector' | 'blocked_disconnected' | 'hash_mismatch' | 'duplicate_execution_blocked' | 'unapproved';
  verifiedAt?: string;
  message?: string;
  error?: string;
}

export function verifyApprovalExecution(params: {
  business: Business;
  approvalId: string;
  approvalStatus: string;
  expectedPayloadHash: string;
  currentPayload: unknown;
  idempotencyKey: string;
  integrationConnected: boolean;
  targetPlatform?: string;
}) {
  return postApi<ApprovalExecutionVerificationResponse>('/api/v1/approvals/verify-execution', params);
}

// =============================================================================
// Auth Context & Phase 1 Multi-Provider Admin / Business AI Settings APIs
// =============================================================================

export interface AuthMeResponse {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  isSuperAdmin: boolean;
}

export function fetchAuthMe() {
  return requestApi<AuthMeResponse>('GET', '/api/v1/auth/me');
}

export interface AdminAiOverviewResponse {
  providers: AiProviderView[];
  models: AiModelSpecView[];
  policy: AiRoutingPolicyView;
  telemetry: AiTelemetrySummaryView;
  recentLogs: AiRequestLogView[];
}

export function fetchAdminAiOverview() {
  return requestApi<AdminAiOverviewResponse>('GET', '/api/v1/admin/ai/overview');
}

export function updateAdminAiProvider(params: {
  id: AiProviderId;
  name?: string;
  enabled?: boolean;
  priority?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fallbackEnabled?: boolean;
  baseUrl?: string;
}) {
  return postApi<{ provider: AiProviderView }>('/api/v1/admin/ai/providers', params);
}

export function saveAdminProviderCredential(providerId: AiProviderId, apiKey: string) {
  return postApi<{ provider: AiProviderView; message: string }>(
    `/api/v1/admin/ai/providers/${providerId}/credentials`,
    { apiKey }
  );
}

export function removeAdminProviderCredential(providerId: AiProviderId) {
  return requestApi<{ provider: AiProviderView; message: string }>(
    'DELETE',
    `/api/v1/admin/ai/providers/${providerId}/credentials`
  );
}

export interface ProviderTestResultResponse {
  result: {
    ok: boolean;
    providerId: AiProviderId;
    status: AiConnectionStatus;
    latencyMs: number;
    message: string;
    detectedModels?: string[];
    checkedAt: string;
  };
  provider?: AiProviderView;
}

export function testAdminProviderConnection(providerId: AiProviderId) {
  return postApi<ProviderTestResultResponse>(`/api/v1/admin/ai/providers/${providerId}/test`, {});
}

export function upsertAdminAiModel(model: Partial<AiModelSpecView> & { providerId: AiProviderId; modelId: string }) {
  return postApi<{ model: AiModelSpecView; models: AiModelSpecView[] }>('/api/v1/admin/ai/models', model);
}

export function updateAdminAiPolicy(params: {
  credentialPolicy?: AiPlatformCredentialPolicy;
  allowBusinessFallbackToPlatform?: boolean;
  defaultCooldownMs?: number;
}) {
  return postApi<{ policy: AiRoutingPolicyView }>('/api/v1/admin/ai/policy', params);
}

export interface BusinessAiSettingsResponse {
  settings: BusinessAiSettingsView;
  telemetry: AiTelemetrySummaryView;
  recentLogs: AiRequestLogView[];
  availableModels: Array<{
    id: string;
    providerId: AiProviderId;
    modelId: string;
    displayName: string;
    capabilities: AiCapability[];
    supportedAspectRatios?: string[];
    resolutionOptions?: string[];
    supportsNegativePrompt?: boolean;
    supportsReferenceImage?: boolean;
    supportsVariation?: boolean;
  }>;
}

export function fetchBusinessAiSettings(business: Business) {
  return postApi<BusinessAiSettingsResponse>('/api/v1/business/ai-settings/get', { business });
}

export function updateBusinessAiSettings(params: {
  business: Business;
  credentialMode?: 'platform' | 'customer';
  preferredProviders?: Partial<Record<AiCapability, AiProviderId>>;
  preferredModels?: Partial<Record<AiCapability, string>>;
  setCustomerKey?: { providerId: AiProviderId; apiKey: string };
  removeCustomerKeyProvider?: AiProviderId;
}) {
  return postApi<{ settings: BusinessAiSettingsView }>('/api/v1/business/ai-settings/update', params);
}

export function testBusinessProviderKey(params: {
  business: Business;
  providerId: AiProviderId;
  apiKey?: string;
}) {
  return postApi<{
    result: {
      ok: boolean;
      providerId: AiProviderId;
      status: AiConnectionStatus;
      latencyMs: number;
      message: string;
      checkedAt: string;
    };
  }>('/api/v1/business/ai-settings/test-key', params);
}

export interface ProviderImageTestResponse {
  result: {
    ok: boolean;
    providerId: AiProviderId;
    modelId: string;
    latencyMs: number;
    message: string;
    errorCode?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    previewDataUrl?: string;
    estimatedCostUsd: number;
    checkedAt: string;
  };
  provider?: AiProviderView;
}

export function testAdminProviderImageGeneration(providerId: AiProviderId, modelId?: string) {
  return postApi<ProviderImageTestResponse>(`/api/v1/admin/ai/providers/${providerId}/test-image`, { modelId });
}

export interface GenerateImagesParams {
  business: Business;
  prompt: string;
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
}

export function generateAiImages(params: GenerateImagesParams) {
  return postApi<{
    job: ImageGenerationJobView;
    assets?: StoredMediaAssetView[];
    providerId?: AiProviderId;
    modelUsed?: string;
    fallbackUsed?: boolean;
    latencyMs?: number;
    estimatedCostUsd?: number;
  }>('/api/v1/ai/images/generate', params);
}

export function getAiImageJobStatus(jobId: string, businessId: string) {
  return requestApi<{ job: ImageGenerationJobView }>(
    'GET',
    `/api/v1/ai/images/jobs/${encodeURIComponent(jobId)}?businessId=${encodeURIComponent(businessId)}`
  );
}

export function retryAiImageJob(jobId: string, business: Business) {
  return postApi<{ job: ImageGenerationJobView }>(`/api/v1/ai/images/jobs/${encodeURIComponent(jobId)}/retry`, {
    business,
  });
}

export function editAiImage(params: {
  business: Business;
  sourceMediaId: string;
  editMode:
    | 'change_background'
    | 'remove_object'
    | 'change_style'
    | 'variation'
    | 'replace_product_bg'
    | 'add_text_space'
    | 'adjust_composition'
    | 'custom';
  instruction: string;
  aspectRatio?: ImageAspectRatio;
  preferredModelId?: string;
}) {
  return postApi<{
    asset: StoredMediaAssetView;
    providerId: AiProviderId;
    modelUsed: string;
    fallbackUsed: boolean;
    latencyMs: number;
    estimatedCostUsd: number;
  }>('/api/v1/ai/images/edit', params);
}

export function composeBrandImage(params: {
  business: Business;
  sourceMediaId: string;
  format: VisualFormatKey;
  aspectRatio?: ImageAspectRatio;
  headline?: string;
  subheadline?: string;
  ctaText?: string;
  logoMediaId?: string;
}) {
  return postApi<{ asset: StoredMediaAssetView }>('/api/v1/ai/images/compose', params);
}

export function listStoredMediaAssets(business: Business) {
  return postApi<{ assets: StoredMediaAssetView[] }>('/api/v1/media/list', { business });
}

export function attachStoredMediaToContent(business: Business, mediaId: string, contentId: string) {
  return postApi<{ asset: StoredMediaAssetView }>('/api/v1/media/attach', { business, mediaId, contentId });
}

export function deleteStoredMediaAsset(businessId: string, mediaId: string) {
  return requestApi<{ ok: boolean }>('DELETE', `/api/v1/media/${encodeURIComponent(businessId)}/${encodeURIComponent(mediaId)}`);
}


