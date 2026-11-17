export type AiProviderId = 'gemini' | 'openai' | 'fal' | 'replicate';

export type AiCapability =
  | 'text_generation'
  | 'structured_json'
  | 'image_generation'
  | 'image_editing'
  | 'image_variation'
  | 'image_understanding'
  | 'video_generation'
  | 'text_to_speech'
  | 'audio_generation'
  | 'media_understanding'
  | 'embeddings';

export type AiConnectionStatus = 'untested' | 'connected' | 'error' | 'not_configured';
export type AiAvailabilityStatus = 'available' | 'degraded' | 'unavailable' | 'disabled';
export type AiCredentialSource = 'platform' | 'customer';
export type AiPlatformCredentialPolicy = 'platform_only' | 'customer_optional' | 'customer_required';

export interface EncryptedSecretBlob {
  ciphertext: string;
  iv: string;
  authTag: string;
  maskedPreview: string;
  updatedAt: string;
}

export interface AiPricingMetadata {
  unit: '1m_tokens' | 'image' | 'second' | '1k_chars';
  inputCostUsd?: number;
  outputCostUsd?: number;
  unitCostUsd?: number;
}

export interface AiModelSpec {
  id: string;
  providerId: AiProviderId;
  modelId: string;
  displayName: string;
  capabilities: AiCapability[];
  inputFormats: string[];
  outputFormats: string[];
  maxInputSize: string;
  maxOutputDurationSec: number | null;
  pricingMetadata: AiPricingMetadata;
  availabilityStatus: AiAvailabilityStatus;
  isDefaultForCapabilities: AiCapability[];
  fallbackEligible: boolean;
  priority: number;
  requiresPaidKey?: boolean;
  supportedAspectRatios?: string[];
  resolutionOptions?: string[];
  supportsNegativePrompt?: boolean;
  supportsReferenceImage?: boolean;
  supportsVariation?: boolean;
  timeoutMs?: number;
}

export interface AiProviderConfig {
  id: AiProviderId;
  name: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  fallbackEnabled: boolean;
  baseUrl: string;
  credentialEnvVar: string;
  connectionStatus: AiConnectionStatus;
  lastTestedAt?: string;
  lastLatencyMs?: number;
  lastTestError?: string;
  detectedModels?: string[];
  lastImageTestAt?: string;
  lastImageTestOk?: boolean;
  lastImageTestModel?: string;
  lastImageTestError?: string;
  updatedAt: string;
}

export interface PublicAiProviderView extends AiProviderConfig {
  hasStoredPlatformKey: boolean;
  hasEnvPlatformKey: boolean;
  hasCredential: boolean;
  maskedCredential: string | null;
  circuitOpenUntil?: number;
}

export interface AiRoutingPolicy {
  credentialPolicy: AiPlatformCredentialPolicy;
  allowBusinessFallbackToPlatform: boolean;
  defaultCooldownMs: number;
}

export interface BusinessAiSettingsRecord {
  businessId: string;
  ownerId: string;
  credentialMode: 'platform' | 'customer';
  preferredProviders?: Partial<Record<AiCapability, AiProviderId>>;
  preferredModels?: Partial<Record<AiCapability, string>>;
  encryptedCustomerKeys: Partial<Record<AiProviderId, EncryptedSecretBlob>>;
  updatedAt: string;
}

export interface PublicBusinessAiSettingsView {
  businessId: string;
  credentialMode: 'platform' | 'customer';
  platformPolicy: AiPlatformCredentialPolicy;
  preferredProviders: Partial<Record<AiCapability, AiProviderId>>;
  preferredModels: Partial<Record<AiCapability, string>>;
  customerKeys: Record<
    AiProviderId,
    {
      configured: boolean;
      maskedPreview: string | null;
      updatedAt?: string;
    }
  >;
  updatedAt: string;
}

export interface AiRequestLogRecord {
  id: string;
  requestId: string;
  businessId: string;
  ownerId: string;
  capability: AiCapability;
  providerId: AiProviderId;
  modelId: string;
  credentialSource: AiCredentialSource;
  status: 'success' | 'fallback_success' | 'error';
  fallbackUsed: boolean;
  attemptedModels: string[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
  estimatedCostUsd: number;
  errorCode?: string;
  errorMessage?: string;
  isTest?: boolean;
  createdAt: string;
}

export interface StructuredJsonRequest {
  modelId: string;
  contents: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
}

export interface StructuredJsonResult {
  parsed: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  modelUsed: string;
}

export type ImageAspectRatio = '1:1' | '4:5' | '3:4' | '4:3' | '9:16' | '16:9';

export interface ImageGenRequest {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: ImageAspectRatio;
  width?: number;
  height?: number;
  resolution?: '1K' | '2K' | '4K';
  numberOfImages?: number;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
  referenceImages?: Array<{ base64: string; mimeType: string }>;
  styleInstructions?: string;
  purpose?: string;
  isVariation?: boolean;
}

export interface ImageGeneratedItem {
  dataBase64: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface ImageGenResult {
  images: ImageGeneratedItem[];
  dataBase64: string;
  mimeType: string;
  width: number;
  height: number;
  modelUsed: string;
  estimatedCostUsd: number;
  generationMetadata?: Record<string, unknown>;
}

export interface VideoGenRequest {
  modelId: string;
  prompt: string;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  durationSec?: number;
  referenceImageUrl?: string;
}

export interface VideoGenResult {
  videoUrl?: string;
  dataBase64?: string;
  mimeType: string;
  modelUsed: string;
  estimatedCostUsd: number;
}

export interface TtsGenRequest {
  modelId: string;
  text: string;
  voiceName?: string;
  style?: string;
}

export interface TtsGenResult {
  audioBase64: string;
  mimeType: string;
  modelUsed: string;
  estimatedCostUsd: number;
}

export interface ProviderConnectionTestResult {
  ok: boolean;
  providerId: AiProviderId;
  status: AiConnectionStatus;
  latencyMs: number;
  message: string;
  detectedModels?: string[];
  checkedAt: string;
}

export interface ProviderImageTestResult {
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
}
