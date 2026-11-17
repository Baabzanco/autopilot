import { getAuthIdToken } from '../lib/firebase';
import type { AgentType, Business, ContentItem, ContentType, Product, ReportType, SocialPlatform } from '../types/domain';

async function postApi<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const token = await getAuthIdToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `خطای سرور (${res.status})`);
  }
  return json as TResponse;
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

