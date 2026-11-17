import crypto from 'crypto';
import type { AiProviderId, ImageAspectRatio } from '../ai/types';
import type { ImageGenerationJobStatus, SignedMediaView } from './store';

export interface ImageGenerationJob {
  jobId: string;
  businessId: string;
  ownerId: string;
  status: ImageGenerationJobStatus;
  requestedCount: number;
  completedCount: number;
  aspectRatio: ImageAspectRatio;
  format?: string;
  prompt: string;
  providerId?: AiProviderId;
  modelUsed?: string;
  fallbackUsed?: boolean;
  estimatedCostUsd?: number;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  retryPayload?: Record<string, unknown>;
  assets: SignedMediaView[];
  createdAt: string;
  updatedAt: string;
}

const MAX_JOBS = 150;

export class ImageJobManager {
  private jobs = new Map<string, ImageGenerationJob>();

  createJob(params: {
    businessId: string;
    ownerId: string;
    requestedCount: number;
    aspectRatio: ImageAspectRatio;
    format?: string;
    prompt: string;
    retryPayload?: Record<string, unknown>;
  }): ImageGenerationJob {
    const now = new Date().toISOString();
    const job: ImageGenerationJob = {
      jobId: `imgjob_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      businessId: params.businessId,
      ownerId: params.ownerId,
      status: 'queued',
      requestedCount: params.requestedCount,
      completedCount: 0,
      aspectRatio: params.aspectRatio,
      format: params.format,
      prompt: params.prompt,
      retryPayload: params.retryPayload,
      assets: [],
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.jobId, job);
    if (this.jobs.size > MAX_JOBS) {
      const oldestKey = this.jobs.keys().next().value;
      if (oldestKey) this.jobs.delete(oldestKey);
    }
    return { ...job };
  }

  updateStatus(jobId: string, patch: Partial<ImageGenerationJob>): ImageGenerationJob | null {
    const existing = this.jobs.get(jobId);
    if (!existing) return null;
    const next: ImageGenerationJob = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, next);
    return { ...next };
  }

  getJob(jobId: string, businessId: string, ownerId: string): ImageGenerationJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (job.businessId !== businessId || job.ownerId !== ownerId) return null;
    return { ...job };
  }
}

export const imageJobManager = new ImageJobManager();
