import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { EncryptedSecretBlob } from './types';

function resolveProjectSalt(): string {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { projectId?: string };
      if (parsed.projectId) return parsed.projectId;
    }
  } catch {
    // Fallback below
  }
  return 'microbusiness-autopilot';
}

function getEncryptionKey(): Buffer {
  const explicit = process.env.AI_CREDENTIALS_ENCRYPTION_KEY?.trim();
  const baseSecret =
    explicit && explicit.length >= 16
      ? explicit
      : `${resolveProjectSalt()}::${process.env.SESSION_SECRET || process.env.GEMINI_API_KEY || 'local-vault-seed'}`;
  return crypto.createHash('sha256').update(baseSecret, 'utf8').digest();
}

export function maskSecret(rawSecret: string): string {
  const trimmed = rawSecret.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) {
    return '••••' + trimmed.slice(-2);
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function encryptSecret(plaintext: string): EncryptedSecretBlob {
  const clean = plaintext.trim();
  if (!clean) {
    throw new Error('SECRET_CANNOT_BE_EMPTY');
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    maskedPreview: maskSecret(clean),
    updatedAt: new Date().toISOString(),
  };
}

export function decryptSecret(blob: EncryptedSecretBlob): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(blob.iv, 'base64');
  const authTag = Buffer.from(blob.authTag, 'base64');
  const ciphertext = Buffer.from(blob.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
