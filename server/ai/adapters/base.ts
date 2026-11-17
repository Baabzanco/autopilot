import type {
  AiProviderConfig,
  AiProviderId,
  ImageGenRequest,
  ImageGenResult,
  ProviderConnectionTestResult,
  StructuredJsonRequest,
  StructuredJsonResult,
  TtsGenRequest,
  TtsGenResult,
  VideoGenRequest,
  VideoGenResult,
} from '../types';

export interface AiProviderAdapter {
  id: AiProviderId;
  testConnection(apiKey: string, config: AiProviderConfig): Promise<ProviderConnectionTestResult>;
  generateStructuredJson?(
    apiKey: string,
    req: StructuredJsonRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<StructuredJsonResult>;
  generateImage?(
    apiKey: string,
    req: ImageGenRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<ImageGenResult>;
  generateVideo?(
    apiKey: string,
    req: VideoGenRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<VideoGenResult>;
  generateSpeech?(
    apiKey: string,
    req: TtsGenRequest,
    config: AiProviderConfig,
    signal: AbortSignal
  ): Promise<TtsGenResult>;
}

export class ProviderExecutionError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(message: string, options: { status?: number; code?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ProviderExecutionError';
    this.status = options.status ?? 500;
    this.code = options.code ?? 'PROVIDER_ERROR';
    this.retryable = options.retryable ?? false;
  }
}
