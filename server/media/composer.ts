import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { ImageAspectRatio } from '../ai/types';

const execFileAsync = promisify(execFile);

export type VisualFormatKey =
  | 'story'
  | 'reel_cover'
  | 'square_post'
  | 'portrait_post'
  | 'carousel_slide'
  | 'landscape_post';

export interface TargetCanvasDimensions {
  width: number;
  height: number;
  aspectRatio: ImageAspectRatio;
}

export function resolveFormatDimensions(format?: VisualFormatKey | string, aspectRatio?: ImageAspectRatio): TargetCanvasDimensions {
  if (format === 'story' || format === 'reel_cover' || aspectRatio === '9:16') {
    return { width: 1080, height: 1920, aspectRatio: '9:16' };
  }
  if (format === 'portrait_post' || format === 'carousel_slide' || aspectRatio === '4:5') {
    return { width: 1080, height: 1350, aspectRatio: '4:5' };
  }
  if (format === 'landscape_post' || aspectRatio === '16:9') {
    return { width: 1920, height: 1080, aspectRatio: '16:9' };
  }
  if (aspectRatio === '3:4') {
    return { width: 1080, height: 1440, aspectRatio: '3:4' };
  }
  if (aspectRatio === '4:3') {
    return { width: 1440, height: 1080, aspectRatio: '4:3' };
  }
  return { width: 1080, height: 1080, aspectRatio: '1:1' };
}

function sanitizeHexColor(raw: string | undefined, fallback: string): string {
  const val = (raw || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(val) ? val : fallback;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text: string, maxCharsPerLine: number): string[] {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if ((current + ' ' + w).length <= maxCharsPerLine) {
      current += ' ' + w;
    } else {
      lines.push(current);
      current = w;
    }
    if (lines.length >= 3) break;
  }
  if (current && lines.length < 3) {
    lines.push(current);
  }
  return lines;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');
}

function hexToAssBgr(hex: string, alphaHex = '00'): string {
  const clean = hex.replace('#', '');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`;
}

export interface ComposeImageOptions {
  sourceBuffer: Buffer;
  sourceMimeType: string;
  format?: VisualFormatKey | string;
  aspectRatio?: ImageAspectRatio;
  brandName?: string;
  headline?: string;
  subheadline?: string;
  ctaText?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoBuffer?: Buffer;
  logoMimeType?: string;
  outputMimeType?: 'image/png' | 'image/jpeg';
}

export interface ComposedImageResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  aspectRatio: ImageAspectRatio;
}

/**
 * Resizes/crops any generated image cleanly to exact Instagram target pixel dimensions
 * (e.g. 1080x1920, 1080x1080, 1080x1350) without distorting aspect ratio.
 */
export async function normalizeImageToTargetDimensions(params: {
  sourceBuffer: Buffer;
  sourceMimeType: string;
  format?: VisualFormatKey | string;
  aspectRatio?: ImageAspectRatio;
}): Promise<{ buffer: Buffer; mimeType: string; width: number; height: number; aspectRatio: ImageAspectRatio }> {
  const dims = resolveFormatDimensions(params.format, params.aspectRatio);
  const ext = params.sourceMimeType.includes('jpeg') ? 'jpg' : params.sourceMimeType.includes('webp') ? 'webp' : 'png';
  const outExt = ext === 'webp' ? 'png' : ext;
  const tmpIn = path.join(os.tmpdir(), `norm-in-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  const tmpOut = path.join(os.tmpdir(), `norm-out-${Date.now()}-${Math.random().toString(36).slice(2)}.${outExt}`);

  try {
    fs.writeFileSync(tmpIn, params.sourceBuffer);
    await execFileAsync('convert', [
      tmpIn,
      '-auto-orient',
      '-resize',
      `${dims.width}x${dims.height}^`,
      '-gravity',
      'center',
      '-extent',
      `${dims.width}x${dims.height}`,
      '-quality',
      '92',
      tmpOut,
    ]);
    const outBuf = fs.readFileSync(tmpOut);
    return {
      buffer: outBuf,
      mimeType: outExt === 'jpg' ? 'image/jpeg' : 'image/png',
      width: dims.width,
      height: dims.height,
      aspectRatio: dims.aspectRatio,
    };
  } finally {
    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}

/**
 * Brand-aware composition engine using ImageMagick + FFmpeg (librsvg + libass with HarfBuzz/FriBidi for connected Persian RTL typography).
 */
export async function composeBrandVisual(opts: ComposeImageOptions): Promise<ComposedImageResult> {
  const dims = resolveFormatDimensions(opts.format, opts.aspectRatio);
  const primary = sanitizeHexColor(opts.primaryColor, '#6366F1');
  const secondary = sanitizeHexColor(opts.secondaryColor, '#8B5CF6');
  const outMime = opts.outputMimeType || 'image/png';
  const outExt = outMime === 'image/jpeg' ? 'jpg' : 'png';

  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpBase = path.join(os.tmpdir(), `cmp-base-${uid}.png`);
  const tmpSvg = path.join(os.tmpdir(), `cmp-overlay-${uid}.svg`);
  const tmpAss = path.join(os.tmpdir(), `cmp-text-${uid}.ass`);
  const tmpLogo = path.join(os.tmpdir(), `cmp-logo-${uid}.png`);
  const tmpMid = path.join(os.tmpdir(), `cmp-mid-${uid}.png`);
  const tmpOut = path.join(os.tmpdir(), `cmp-out-${uid}.${outExt}`);

  try {
    // 1. Center-crop & scale base visual to exact target pixels
    const normalized = await normalizeImageToTargetDimensions({
      sourceBuffer: opts.sourceBuffer,
      sourceMimeType: opts.sourceMimeType,
      format: opts.format,
      aspectRatio: opts.aspectRatio,
    });
    fs.writeFileSync(tmpBase, normalized.buffer);

    const hasText = Boolean(opts.headline?.trim() || opts.subheadline?.trim() || opts.ctaText?.trim() || opts.brandName?.trim());
    const isStory = dims.height > dims.width * 1.4;
    const safeTop = isStory ? 190 : 64;
    const safeBottom = isStory ? 220 : 64;
    const scrimHeight = Math.round(dims.height * (isStory ? 0.44 : 0.48));
    const scrimY = dims.height - scrimHeight;

    // 2. Build vector scrim, accent frame, and CTA badge via librsvg
    const ctaClean = (opts.ctaText || '').trim().slice(0, 40);
    const ctaWidth = ctaClean ? Math.min(dims.width - 140, Math.max(240, ctaClean.length * 16 + 80)) : 0;
    const ctaY = dims.height - safeBottom - 68;
    const ctaX = Math.round((dims.width - ctaWidth) / 2);

    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${dims.width}" height="${dims.height}" viewBox="0 0 ${dims.width} ${dims.height}">
  <defs>
    <linearGradient id="bottomScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#060913" stop-opacity="0"/>
      <stop offset="45%" stop-color="#060913" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="#060913" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#060913" stop-opacity="0.68"/>
      <stop offset="100%" stop-color="#060913" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="brandBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${escapeXml(primary)}"/>
      <stop offset="100%" stop-color="${escapeXml(secondary)}"/>
    </linearGradient>
  </defs>
  ${hasText ? `<rect x="0" y="0" width="${dims.width}" height="240" fill="url(#topScrim)"/>` : ''}
  ${hasText ? `<rect x="0" y="${scrimY}" width="${dims.width}" height="${scrimHeight}" fill="url(#bottomScrim)"/>` : ''}
  <rect x="0" y="0" width="${dims.width}" height="10" fill="url(#brandBar)"/>
  <rect x="64" y="${dims.height - safeBottom - (ctaClean ? 94 : 18)}" width="96" height="6" rx="3" fill="url(#brandBar)"/>
  ${
    ctaClean
      ? `<rect x="${ctaX}" y="${ctaY}" width="${ctaWidth}" height="62" rx="14" fill="url(#brandBar)" opacity="0.96"/>`
      : ''
  }
</svg>`;
    fs.writeFileSync(tmpSvg, svgContent, 'utf-8');

    // 3. Build ASS subtitle overlay with Noto Sans Arabic + HarfBuzz/FriBidi shaping
    const headlineLines = wrapLines(opts.headline || '', isStory ? 26 : 30);
    const subLines = wrapLines(opts.subheadline || '', isStory ? 34 : 38);
    const brandClean = (opts.brandName || '').trim().slice(0, 48);

    const headlineMarginV = safeBottom + (ctaClean ? 132 : 52) + (subLines.length > 0 ? subLines.length * 46 + 18 : 0);
    const subMarginV = safeBottom + (ctaClean ? 114 : 38);
    const ctaMarginV = safeBottom + 16;

    const assEvents: string[] = [];
    if (brandClean) {
      assEvents.push(`Dialogue: 0,0:00:00.00,0:00:05.00,BrandStyle,,0,0,${safeTop},,{\\pos(${dims.width - 72},${safeTop + 18})}${escapeAssText(brandClean)}`);
    }
    if (headlineLines.length > 0) {
      assEvents.push(
        `Dialogue: 0,0:00:00.00,0:00:05.00,HeadlineStyle,,0,0,${headlineMarginV},,${escapeAssText(headlineLines.join('\n'))}`
      );
    }
    if (subLines.length > 0) {
      assEvents.push(
        `Dialogue: 0,0:00:00.00,0:00:05.00,SubStyle,,0,0,${subMarginV},,${escapeAssText(subLines.join('\n'))}`
      );
    }
    if (ctaClean) {
      assEvents.push(
        `Dialogue: 1,0:00:00.00,0:00:05.00,CtaStyle,,0,0,${ctaMarginV},,${escapeAssText(ctaClean)}`
      );
    }

    const assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${dims.width}
PlayResY: ${dims.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: BrandStyle,Noto Sans Arabic,34,${hexToAssBgr('#F8FAFC')},${hexToAssBgr('#F8FAFC')},&H60000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,9,64,64,${safeTop},1
Style: HeadlineStyle,Noto Sans Arabic,${isStory ? 54 : 50},${hexToAssBgr('#FFFFFF')},${hexToAssBgr('#FFFFFF')},&H70000000,&H90000000,-1,0,0,0,100,100,0,0,1,2.5,2,2,72,72,${headlineMarginV},1
Style: SubStyle,Noto Sans Arabic,34,${hexToAssBgr('#E2E8F0')},${hexToAssBgr('#E2E8F0')},&H60000000,&H80000000,0,0,0,0,100,100,0,0,1,1.8,1,2,72,72,${subMarginV},1
Style: CtaStyle,Noto Sans Arabic,32,${hexToAssBgr('#FFFFFF')},${hexToAssBgr('#FFFFFF')},&H20000000,&H40000000,-1,0,0,0,100,100,0,0,1,1,0,2,72,72,${ctaMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${assEvents.join('\n')}
`;
    fs.writeFileSync(tmpAss, assContent, 'utf-8');

    // 4. Composite SVG overlay + ASS Persian typography onto base image with FFmpeg
    const assEscaped = tmpAss.replace(/\\/g, '/').replace(/:/g, '\\:');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      tmpBase,
      '-i',
      tmpSvg,
      '-filter_complex',
      `[0:v][1:v]overlay=0:0,ass='${assEscaped}'`,
      '-frames:v',
      '1',
      tmpMid,
    ]);

    // 5. Optional Brand Logo badge in top-left safe zone
    if (opts.logoBuffer && opts.logoBuffer.length > 0) {
      const logoExt = opts.logoMimeType?.includes('jpeg') ? 'jpg' : 'png';
      const tmpLogoIn = path.join(os.tmpdir(), `cmp-logoin-${uid}.${logoExt}`);
      try {
        fs.writeFileSync(tmpLogoIn, opts.logoBuffer);
        await execFileAsync('convert', [
          tmpLogoIn,
          '-auto-orient',
          '-resize',
          '112x112',
          '-background',
          'none',
          '-gravity',
          'center',
          '-extent',
          '112x112',
          tmpLogo,
        ]);
        await execFileAsync('convert', [
          tmpMid,
          tmpLogo,
          '-gravity',
          'NorthWest',
          '-geometry',
          `+64+${safeTop - 8}`,
          '-composite',
          ...(outExt === 'jpg' ? ['-quality', '92'] : []),
          tmpOut,
        ]);
      } finally {
        if (fs.existsSync(tmpLogoIn)) fs.unlinkSync(tmpLogoIn);
      }
    } else if (outExt === 'jpg') {
      await execFileAsync('convert', [tmpMid, '-quality', '92', tmpOut]);
    } else {
      fs.copyFileSync(tmpMid, tmpOut);
    }

    const finalBuf = fs.readFileSync(tmpOut);
    return {
      buffer: finalBuf,
      mimeType: outMime,
      width: dims.width,
      height: dims.height,
      aspectRatio: dims.aspectRatio,
    };
  } finally {
    for (const f of [tmpBase, tmpSvg, tmpAss, tmpLogo, tmpMid, tmpOut]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
}
