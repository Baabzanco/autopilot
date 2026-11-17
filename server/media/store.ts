import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { AiProviderId, ImageAspectRatio } from '../ai/types';
import { detectImageDimensions } from './dimensions';

const execFileAsync = promisify(execFile);

export type ImageGenerationJobStatus =
  | 'queued'
  | 'generating'
  | 'processing'
  | 'saving'
  | 'completed'
  | 'failed';

export interface StoredMediaRecord {
  id: string;
  businessId: string;
  ownerId: string;
  contentId?: string;
  parentMediaId?: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  aspectRatio?: ImageAspectRatio;
  purpose?: string;
  prompt?: string;
  negativePrompt?: string;
  styleInstructions?: string;
  providerId?: AiProviderId;
  modelId?: string;
  latencyMs?: number;
  estimatedCostUsd?: number;
  composed: boolean;
  editMode?: string;
  storageKey: string;
  compactPreviewDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaStorageBackend {
  putObject(storageKey: string, data: Buffer): Promise<void>;
  getObject(storageKey: string): Promise<Buffer | null>;
  deleteObject(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}

export class LocalDiskMediaStorage implements MediaStorageBackend {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private resolveSafePath(storageKey: string): string {
    const cleanKey = storageKey.replace(/^\/+/, '');
    const resolved = path.resolve(this.rootDir, cleanKey);
    const rootResolved = path.resolve(this.rootDir);
    if (!resolved.startsWith(rootResolved + path.sep)) {
      throw new Error('INVALID_STORAGE_KEY');
    }
    return resolved;
  }

  async putObject(storageKey: string, data: Buffer): Promise<void> {
    const fullPath = this.resolveSafePath(storageKey);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
  }

  async getObject(storageKey: string): Promise<Buffer | null> {
    const fullPath = this.resolveSafePath(storageKey);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  }

  async deleteObject(storageKey: string): Promise<void> {
    const fullPath = this.resolveSafePath(storageKey);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const fullPath = this.resolveSafePath(storageKey);
    return fs.existsSync(fullPath);
  }
}

function resolveMediaSigningSecret(): Buffer {
  const seed =
    process.env.MEDIA_SIGNING_SECRET ||
    process.env.AI_CREDENTIALS_SECRET ||
    process.env.GEMINI_API_KEY ||
    `mb-autopilot-media-signing-${process.cwd()}`;
  return crypto.createHash('sha256').update(seed, 'utf8').digest();
}

export function extFromMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  return 'png';
}

export async function generateCompactJpegPreview(buf: Buffer, extHint = 'png'): Promise<string | undefined> {
  const tmpIn = path.join(os.tmpdir(), `med-prev-in-${Date.now()}-${Math.random().toString(36).slice(2)}.${extHint}`);
  const tmpOut = path.join(os.tmpdir(), `med-prev-out-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    fs.writeFileSync(tmpIn, buf);
    await execFileAsync('convert', [
      tmpIn,
      '-auto-orient',
      '-resize',
      '640x640>',
      '-strip',
      '-quality',
      '78',
      tmpOut,
    ]);
    if (fs.existsSync(tmpOut)) {
      const outBuf = fs.readFileSync(tmpOut);
      const dataUrl = `data:image/jpeg;base64,${outBuf.toString('base64')}`;
      return dataUrl.length <= 320_000 ? dataUrl : undefined;
    }
  } catch {
    return undefined;
  } finally {
    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
  return undefined;
}

export interface SignedMediaView extends StoredMediaRecord {
  signedUrl: string;
}

export class PersistentMediaStore {
  private indexPath: string;
  private storage: MediaStorageBackend;
  private records: StoredMediaRecord[];

  constructor(options?: { rootDir?: string; indexPath?: string; storage?: MediaStorageBackend }) {
    const mediaRoot = options?.rootDir || path.resolve(process.cwd(), 'data', 'media');
    this.indexPath = options?.indexPath || path.resolve(process.cwd(), 'data', 'media-index.json');
    this.storage = options?.storage || new LocalDiskMediaStorage(mediaRoot);
    this.records = this.loadIndex();
  }

  private loadIndex(): StoredMediaRecord[] {
    try {
      if (fs.existsSync(this.indexPath)) {
        const raw = fs.readFileSync(this.indexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as StoredMediaRecord[]) : [];
      }
    } catch (err) {
      console.warn('Could not load media index, initializing empty list:', err);
    }
    return [];
  }

  private persistIndex() {
    try {
      const dir = path.dirname(this.indexPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.indexPath, JSON.stringify(this.records, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist media index:', err);
    }
  }

  signMediaUrl(businessId: string, mediaId: string, ttlSeconds = 86_400): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${businessId}:${mediaId}:${exp}`;
    const sig = crypto
      .createHmac('sha256', resolveMediaSigningSecret())
      .update(payload)
      .digest('hex');
    return `/api/v1/media/file/${encodeURIComponent(businessId)}/${encodeURIComponent(mediaId)}?exp=${exp}&sig=${sig}`;
  }

  verifySignedUrl(businessId: string, mediaId: string, expRaw: string, sigRaw: string): boolean {
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    if (!sigRaw || !/^[a-f0-9]{64}$/i.test(sigRaw)) {
      return false;
    }
    const payload = `${businessId}:${mediaId}:${exp}`;
    const expected = crypto
      .createHmac('sha256', resolveMediaSigningSecret())
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sigRaw.toLowerCase(), 'hex'));
  }

  toSignedView(rec: StoredMediaRecord): SignedMediaView {
    return {
      ...rec,
      signedUrl: this.signMediaUrl(rec.businessId, rec.id),
    };
  }

  async saveImageBuffer(params: {
    id?: string;
    businessId: string;
    ownerId: string;
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    width?: number;
    height?: number;
    aspectRatio?: ImageAspectRatio;
    purpose?: string;
    prompt?: string;
    negativePrompt?: string;
    styleInstructions?: string;
    providerId?: AiProviderId;
    modelId?: string;
    latencyMs?: number;
    estimatedCostUsd?: number;
    contentId?: string;
    parentMediaId?: string;
    versionNumber?: number;
    composed?: boolean;
    editMode?: string;
  }): Promise<SignedMediaView> {
    const mediaId = params.id || `med_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const ext = extFromMimeType(params.mimeType);
    const storageKey = `${params.businessId.replace(/[^a-zA-Z0-9_-]/g, '_')}/${mediaId}.${ext}`;
    const dims =
      params.width && params.height
        ? { width: params.width, height: params.height }
        : await detectImageDimensions(params.buffer, ext);

    await this.storage.putObject(storageKey, params.buffer);
    const compactPreviewDataUrl = await generateCompactJpegPreview(params.buffer, ext);

    const now = new Date().toISOString();
    const record: StoredMediaRecord = {
      id: mediaId,
      businessId: params.businessId,
      ownerId: params.ownerId,
      ...(params.contentId ? { contentId: params.contentId } : {}),
      ...(params.parentMediaId ? { parentMediaId: params.parentMediaId } : {}),
      versionNumber: params.versionNumber ?? 1,
      fileName: params.fileName,
      mimeType: params.mimeType,
      fileSize: params.buffer.length,
      width: dims.width,
      height: dims.height,
      aspectRatio: params.aspectRatio,
      purpose: params.purpose,
      prompt: params.prompt?.slice(0, 1200),
      negativePrompt: params.negativePrompt?.slice(0, 400),
      styleInstructions: params.styleInstructions?.slice(0, 400),
      providerId: params.providerId,
      modelId: params.modelId,
      latencyMs: params.latencyMs,
      estimatedCostUsd: params.estimatedCostUsd,
      composed: Boolean(params.composed),
      editMode: params.editMode,
      storageKey,
      compactPreviewDataUrl,
      createdAt: now,
      updatedAt: now,
    };

    this.records.unshift(record);
    this.persistIndex();
    return this.toSignedView(record);
  }

  listByBusiness(businessId: string, ownerId: string): SignedMediaView[] {
    return this.records
      .filter((r) => r.businessId === businessId && r.ownerId === ownerId)
      .map((r) => this.toSignedView(r));
  }

  getRecordForBusiness(businessId: string, mediaId: string, ownerId?: string): StoredMediaRecord | null {
    const rec = this.records.find((r) => r.id === mediaId);
    if (!rec) return null;
    if (rec.businessId !== businessId) return null;
    if (ownerId && rec.ownerId !== ownerId) return null;
    return rec;
  }

  async readMediaBuffer(businessId: string, mediaId: string, ownerId?: string): Promise<{ record: StoredMediaRecord; buffer: Buffer } | null> {
    const rec = this.getRecordForBusiness(businessId, mediaId, ownerId);
    if (!rec) return null;
    const buffer = await this.storage.getObject(rec.storageKey);
    if (!buffer) return null;
    return { record: rec, buffer };
  }

  attachContentId(businessId: string, ownerId: string, mediaId: string, contentId: string): SignedMediaView | null {
    const idx = this.records.findIndex(
      (r) => r.id === mediaId && r.businessId === businessId && r.ownerId === ownerId
    );
    if (idx === -1) return null;
    this.records[idx] = {
      ...this.records[idx],
      contentId,
      updatedAt: new Date().toISOString(),
    };
    this.persistIndex();
    return this.toSignedView(this.records[idx]);
  }

  async deleteMedia(businessId: string, ownerId: string, mediaId: string): Promise<boolean> {
    const idx = this.records.findIndex(
      (r) => r.id === mediaId && r.businessId === businessId && r.ownerId === ownerId
    );
    if (idx === -1) return false;
    const [removed] = this.records.splice(idx, 1);
    this.persistIndex();
    await this.storage.deleteObject(removed.storageKey);
    return true;
  }
}

export const persistentMediaStore = new PersistentMediaStore();
