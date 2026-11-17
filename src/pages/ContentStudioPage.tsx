import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  composeBrandImage,
  editAiImage,
  fetchBusinessAiSettings,
  generateAiImages,
  generateContentDraft,
  getAiImageJobStatus,
  listStoredMediaAssets,
  repurposeContentDraft,
  retryAiImageJob,
  attachStoredMediaToContent,
  type BusinessAiSettingsResponse,
} from '../services/apiClient';
import {
  createApprovalRequest,
  createContentItem,
  createMediaAsset,
  deleteContentItem,
  logActivity,
  updateContentItem,
} from '../services/dataAccess';
import { formatCurrency, formatNumber } from '../lib/localization';
import type {
  Business,
  ContentItem,
  ContentStatus,
  ContentType,
  ImageAspectRatio,
  ImageGenerationJobView,
  MediaAsset,
  Product,
  SocialPlatform,
  StoredMediaAssetView,
  VisualFormatKey,
} from '../types/domain';
import { ConfirmationDialog, EmptyState, ErrorState, MetricCard, StatusIndicator } from '../components/ui/Primitives';

const PLATFORMS: SocialPlatform[] = ['instagram', 'telegram', 'youtube', 'linkedin', 'tiktok', 'x', 'newsletter'];
const FORMATS: ContentType[] = ['post', 'carousel', 'reel_script', 'short_script', 'video_description', 'story', 'thread', 'newsletter'];

type GenerationOutputMode = 'text_only' | 'image_only' | 'text_and_image';

interface QuickVisualTemplate {
  key: VisualFormatKey;
  label: string;
  dimensionsLabel: string;
  aspectRatio: ImageAspectRatio;
  platform: SocialPlatform;
  contentType: ContentType;
}

const VISUAL_TEMPLATES: QuickVisualTemplate[] = [
  {
    key: 'story',
    label: 'استوری اینستاگرام',
    dimensionsLabel: '۱۰۸۰×۱۹۲۰ (۹:۱۶)',
    aspectRatio: '9:16',
    platform: 'instagram',
    contentType: 'story',
  },
  {
    key: 'reel_cover',
    label: 'کاور ریلز',
    dimensionsLabel: '۱۰۸۰×۱۹۲۰ (۹:۱۶)',
    aspectRatio: '9:16',
    platform: 'instagram',
    contentType: 'reel_script',
  },
  {
    key: 'square_post',
    label: 'پست مربعی',
    dimensionsLabel: '۱۰۸۰×۱۰۸۰ (۱:۱)',
    aspectRatio: '1:1',
    platform: 'instagram',
    contentType: 'post',
  },
  {
    key: 'carousel_slide',
    label: 'اسلاید کاروسل',
    dimensionsLabel: '۱۰۸۰×۱۳۵۰ (۴:۵)',
    aspectRatio: '4:5',
    platform: 'instagram',
    contentType: 'carousel',
  },
  {
    key: 'portrait_post',
    label: 'پست پرتره',
    dimensionsLabel: '۱۰۸۰×۱۳۵۰ (۴:۵)',
    aspectRatio: '4:5',
    platform: 'instagram',
    contentType: 'post',
  },
];

const VISUAL_STYLES = [
  'مینیمال استودیویی و مدرن',
  'عکاسی تبلیغاتی لوکس با نورپردازی حرفه‌ای',
  'تحریریه روشن و طبیعی',
  'گرافیک مدرن سه‌بعدی و پرانرژی',
  'الهام‌گرفته از پالت و شخصیت برند',
];

const JOB_STATUS_LABELS: Record<ImageGenerationJobView['status'], string> = {
  queued: 'در صف تولید تصویر',
  generating: 'در حال تولید تصویر با هوش مصنوعی...',
  processing: 'در حال پردازش و تنظیم ابعاد استاندارد...',
  saving: 'در حال ذخیره‌سازی امن در کتابخانه رسانه...',
  completed: 'تولید تصویر با موفقیت تکمیل شد',
  failed: 'تولید تصویر با خطا متوقف شد',
};

const EDIT_MODES: Array<{
  key:
    | 'change_background'
    | 'replace_product_bg'
    | 'add_text_space'
    | 'change_style'
    | 'remove_object'
    | 'adjust_composition'
    | 'variation';
  label: string;
  requiresVariation?: boolean;
}> = [
  { key: 'change_background', label: 'تغییر پس‌زمینه' },
  { key: 'replace_product_bg', label: 'جایگذاری محصول روی صحنه تبلیغاتی' },
  { key: 'add_text_space', label: 'ایجاد فضای خالی برای تیتر فارسی' },
  { key: 'change_style', label: 'تغییر سبک بصری' },
  { key: 'remove_object', label: 'حذف شیء مزاحم' },
  { key: 'adjust_composition', label: 'تنظیم ترکیب‌بندی و نور' },
  { key: 'variation', label: 'تولید نسخه متنوع (Variation)', requiresVariation: true },
];

export function ContentStudioPage({
  business,
  ownerId,
  content,
  mediaAssets,
  products = [],
}: {
  business: Business;
  ownerId: string;
  content: ContentItem[];
  mediaAssets: MediaAsset[];
  products?: Product[];
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [selectedId, setSelectedId] = useState<string | null>(content[0]?.id || null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Server media + AI image capability state
  const [storedMedia, setStoredMedia] = useState<StoredMediaAssetView[]>([]);
  const [availableModels, setAvailableModels] = useState<BusinessAiSettingsResponse['availableModels']>([]);
  const [loadingStudioMeta, setLoadingStudioMeta] = useState(false);

  // AI Generator Panel state
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [outputMode, setOutputMode] = useState<GenerationOutputMode>('text_and_image');
  const [aiMode, setAiMode] = useState<'idea' | 'topic' | 'url' | 'improve'>('topic');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPlatform, setAiPlatform] = useState<SocialPlatform>('instagram');
  const [aiType, setAiType] = useState<ContentType>('post');
  const [aiObjective, setAiObjective] = useState('معرفی جذاب و افزایش تعامل مخاطبان');
  const [aiLang, setAiLang] = useState<'fa' | 'en' | 'ar'>('fa');
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  // Image Generation Config
  const [visualFormat, setVisualFormat] = useState<VisualFormatKey>('square_post');
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [visualStyle, setVisualStyle] = useState<string>(VISUAL_STYLES[0]);
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('1K');
  const [numberOfImages, setNumberOfImages] = useState<number>(1);
  const [preferredImageModelId, setPreferredImageModelId] = useState<string>('');
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  const [autoBrandOverlay, setAutoBrandOverlay] = useState<boolean>(false);
  const [overlayHeadline, setOverlayHeadline] = useState<string>('');
  const [overlaySubheadline, setOverlaySubheadline] = useState<string>('');
  const [overlayCta, setOverlayCta] = useState<string>('');
  const [overlayLogoId, setOverlayLogoId] = useState<string>('');

  const [generating, setGenerating] = useState(false);
  const [activeImageJob, setActiveImageJob] = useState<ImageGenerationJobView | null>(null);
  const [activeJobContentId, setActiveJobContentId] = useState<string | null>(null);
  const syncedJobAssetsRef = useRef<Set<string>>(new Set());

  // Repurpose Modal state
  const [showRepurpose, setShowRepurpose] = useState(false);
  const [repurposeTargets, setRepurposeTargets] = useState<SocialPlatform[]>(['telegram', 'linkedin']);
  const [repurposing, setRepurposing] = useState(false);

  // Editor state
  const activeItem = content.find((c) => c.id === selectedId) || null;
  const loadedItemIdRef = useRef<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPlatform, setEditPlatform] = useState<SocialPlatform>('instagram');
  const [editType, setEditType] = useState<ContentType>('post');
  const [editCaption, setEditCaption] = useState('');
  const [editScript, setEditScript] = useState('');
  const [editCta, setEditCta] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editLanguage, setEditLanguage] = useState<'fa' | 'en' | 'ar'>('fa');
  const [editMediaIds, setEditMediaIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Visual Studio sub-panel state (per selected ContentItem)
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);
  const [visualActionTab, setVisualActionTab] = useState<'preview' | 'compose' | 'edit'>('preview');

  // Brand Composition controls
  const [compFormat, setCompFormat] = useState<VisualFormatKey>('square_post');
  const [compHeadline, setCompHeadline] = useState('');
  const [compSubheadline, setCompSubheadline] = useState('');
  const [compCta, setCompCta] = useState('');
  const [compLogoId, setCompLogoId] = useState('');
  const [composing, setComposing] = useState(false);

  // AI Image Edit / Variation controls
  const [editImgMode, setEditImgMode] = useState<
    | 'change_background'
    | 'replace_product_bg'
    | 'add_text_space'
    | 'change_style'
    | 'remove_object'
    | 'adjust_composition'
    | 'variation'
  >('change_background');
  const [editImgInstruction, setEditImgInstruction] = useState('');
  const [editImgModelId, setEditImgModelId] = useState('');
  const [editingImg, setEditingImg] = useState(false);

  const imageGenModels = useMemo(
    () => availableModels.filter((m) => m.capabilities.includes('image_generation')),
    [availableModels]
  );
  const imageEditModels = useMemo(
    () => availableModels.filter((m) => m.capabilities.includes('image_editing')),
    [availableModels]
  );
  const imageVariationModels = useMemo(
    () => availableModels.filter((m) => m.capabilities.includes('image_variation')),
    [availableModels]
  );

  const selectedModelSpec = useMemo(
    () => imageGenModels.find((m) => m.modelId === preferredImageModelId) || imageGenModels[0] || null,
    [imageGenModels, preferredImageModelId]
  );

  const supportedResolutions = useMemo(
    () => (selectedModelSpec?.resolutionOptions?.length ? selectedModelSpec.resolutionOptions : ['1K']),
    [selectedModelSpec]
  );

  const loadStudioMeta = useCallback(async () => {
    setLoadingStudioMeta(true);
    try {
      const [mediaRes, aiRes] = await Promise.all([
        listStoredMediaAssets(business).catch(() => ({ assets: [] as StoredMediaAssetView[] })),
        fetchBusinessAiSettings(business).catch(() => null),
      ]);
      setStoredMedia(mediaRes.assets || []);
      if (aiRes?.availableModels) {
        setAvailableModels(aiRes.availableModels);
      }
    } finally {
      setLoadingStudioMeta(false);
    }
  }, [business]);

  useEffect(() => {
    void loadStudioMeta();
  }, [loadStudioMeta]);

  useEffect(() => {
    if (!selectedId && content.length > 0) {
      setSelectedId(content[0].id);
    }
  }, [content, selectedId]);

  const loadIntoEditor = useCallback((item: ContentItem) => {
    loadedItemIdRef.current = item.id;
    setSelectedId(item.id);
    setEditTitle(item.title);
    setEditPlatform(item.platform);
    setEditType(item.contentType);
    setEditCaption(item.caption || '');
    setEditScript(item.script || '');
    setEditCta(item.cta || '');
    setEditHashtags((item.hashtags || []).join('، '));
    setEditLanguage(item.language || 'fa');
    setEditMediaIds(item.mediaIds || []);
    setCompHeadline(item.title || '');
    setCompCta(item.cta || '');
    setCompFormat(item.contentType === 'story' ? 'story' : item.contentType === 'carousel' ? 'carousel_slide' : 'square_post');
    setSelectedVisualId(null);
    setFeedback(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (activeItem && loadedItemIdRef.current !== activeItem.id) {
      loadIntoEditor(activeItem);
    }
  }, [activeItem, loadIntoEditor]);

  useEffect(() => {
    if (!supportedResolutions.includes(resolution)) {
      setResolution('1K');
    }
  }, [supportedResolutions, resolution]);

  const syncSavedAssetsToContent = useCallback(
    async (targetContentId: string, assets: StoredMediaAssetView[], existingContentMediaIds: string[]) => {
      const addedFsIds: string[] = [];
      for (const asset of assets) {
        if (asset.contentId !== targetContentId) {
          await attachStoredMediaToContent(business, asset.id, targetContentId).catch(() => null);
        }
        const alreadyFs = mediaAssets.find((m) => m.storagePath === asset.id);
        if (alreadyFs) {
          addedFsIds.push(alreadyFs.id);
        } else {
          const fsId = await createMediaAsset(business.id, ownerId, {
            fileName: asset.fileName,
            category: 'image',
            mimeType: asset.mimeType,
            fileSize: asset.fileSize,
            previewUrl: asset.compactPreviewDataUrl || '',
            storagePath: asset.id,
            relatedContentIds: [targetContentId],
          });
          addedFsIds.push(fsId);
        }
      }
      const merged = Array.from(new Set([...existingContentMediaIds, ...addedFsIds])).slice(0, 15);
      await updateContentItem(business.id, targetContentId, { mediaIds: merged });
      if (loadedItemIdRef.current === targetContentId) {
        setEditMediaIds(merged);
      }
      await loadStudioMeta();
      if (assets.length > 0) {
        setSelectedVisualId(assets[assets.length - 1].id);
      }
    },
    [business, ownerId, mediaAssets, loadStudioMeta]
  );

  // Poll async image generation job
  useEffect(() => {
    if (!activeImageJob) return;
    if (activeImageJob.status === 'completed' || activeImageJob.status === 'failed') {
      if (
        activeImageJob.status === 'completed' &&
        activeImageJob.assets.length > 0 &&
        activeJobContentId &&
        !syncedJobAssetsRef.current.has(activeImageJob.jobId)
      ) {
        syncedJobAssetsRef.current.add(activeImageJob.jobId);
        const existingIds = content.find((c) => c.id === activeJobContentId)?.mediaIds || [];
        void syncSavedAssetsToContent(activeJobContentId, activeImageJob.assets, existingIds).then(() => {
          setFeedback(
            `${formatNumber(activeImageJob.assets.length, locale, numeralStyle)} خروجی تصویر واقعی تولید و در محتوا و کتابخانه رسانه ذخیره شد.`
          );
          setGenerating(false);
        });
      } else if (activeImageJob.status === 'failed') {
        setError(activeImageJob.errorMessage || 'تولید تصویر با خطا مواجه شد.');
        setGenerating(false);
      }
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const res = await getAiImageJobStatus(activeImageJob.jobId, business.id);
        setActiveImageJob(res.job);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'خطا در پیگیری وضعیت تولید تصویر');
        setGenerating(false);
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeImageJob, activeJobContentId, business.id, content, locale, numeralStyle, syncSavedAssetsToContent]);

  // Linked server visuals for activeItem
  const activeItemVisuals = useMemo(() => {
    if (!activeItem) return [];
    const linkedFsIds = new Set(activeItem.mediaIds || []);
    const linkedServerIds = new Set(
      mediaAssets.filter((m) => linkedFsIds.has(m.id) && m.storagePath).map((m) => m.storagePath!)
    );
    return storedMedia.filter((s) => s.contentId === activeItem.id || linkedServerIds.has(s.id));
  }, [activeItem, storedMedia, mediaAssets]);

  const selectedVisual = useMemo(
    () => activeItemVisuals.find((v) => v.id === selectedVisualId) || activeItemVisuals[0] || null,
    [activeItemVisuals, selectedVisualId]
  );

  const applyTemplate = (tpl: QuickVisualTemplate) => {
    setVisualFormat(tpl.key);
    setAspectRatio(tpl.aspectRatio);
    setAiPlatform(tpl.platform);
    setAiType(tpl.contentType);
  };

  const handleCreateBlank = async () => {
    setError(null);
    const id = await createContentItem(business.id, ownerId, {
      title: 'پیش‌نویس جدید',
      platform: 'instagram',
      contentType: 'post',
      language: 'fa',
      caption: '',
      script: '',
      hashtags: [],
      status: 'draft',
      aiGenerated: false,
    });
    loadedItemIdRef.current = id;
    setSelectedId(id);
    setEditTitle('پیش‌نویس جدید');
    setEditPlatform('instagram');
    setEditType('post');
    setEditCaption('');
    setEditScript('');
    setEditCta('');
    setEditHashtags('');
    setEditLanguage('fa');
    setEditMediaIds([]);
    setSelectedVisualId(null);
  };

  const startAsyncImageJobForContent = async (params: {
    targetContentId: string;
    promptText: string;
    format: VisualFormatKey;
    ratio: ImageAspectRatio;
    count: number;
    headline?: string;
    ctaText?: string;
  }) => {
    const startRes = await generateAiImages({
      business,
      prompt: params.promptText,
      negativePrompt: negativePrompt.trim() || undefined,
      visualStyle,
      aspectRatio: params.ratio,
      format: params.format,
      resolution,
      numberOfImages: params.count,
      preferredModelId: preferredImageModelId || undefined,
      contentId: params.targetContentId,
      purpose: params.format,
      composeBrandOverlay: autoBrandOverlay
        ? {
            enabled: true,
            headline: (overlayHeadline || params.headline || '').trim() || undefined,
            subheadline: overlaySubheadline.trim() || undefined,
            ctaText: (overlayCta || params.ctaText || '').trim() || undefined,
            logoMediaId: overlayLogoId || undefined,
          }
        : undefined,
      async: true,
    });
    setActiveJobContentId(params.targetContentId);
    setActiveImageJob(startRes.job);
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    setError(null);
    setFeedback(null);
    setActiveImageJob(null);

    const product = products.find((p) => p.id === selectedProductId);
    const productContext = product
      ? `\nمحصول مرتبط: ${product.name} (${formatCurrency(product.price, product.currency, locale, numeralStyle)})${
          product.description ? ` — ${product.description.slice(0, 220)}` : ''
        }`
      : '';

    try {
      let targetContentId = '';
      let generatedTitle = aiPrompt.trim().slice(0, 65);
      let generatedCta = '';

      if (outputMode === 'text_only' || outputMode === 'text_and_image') {
        const res = await generateContentDraft({
          mode: aiMode,
          promptInput: `${aiPrompt.trim()}${productContext}`,
          platform: aiPlatform,
          contentType: aiType,
          objective: aiObjective,
          tone: business.brandSettings?.voice || 'صمیمی و حرفه‌ای',
          language: aiLang,
          business,
        });

        const slideText =
          res.slides.length > 0
            ? `${res.script ? res.script + '\n\n' : ''}اسلایدهای پیشنهادی:\n${res.slides.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
            : res.script;

        targetContentId = await createContentItem(business.id, ownerId, {
          title: res.title,
          platform: aiPlatform,
          contentType: aiType,
          topic: aiPrompt.slice(0, 280),
          objective: aiObjective,
          language: aiLang,
          caption: res.caption,
          script: slideText,
          cta: res.cta,
          hashtags: res.hashtags,
          status: 'draft',
          aiGenerated: true,
          aiModel: res.modelUsed || 'gemini-4-hydrogen',
        });

        generatedTitle = res.title;
        generatedCta = res.cta;

        loadedItemIdRef.current = targetContentId;
        setSelectedId(targetContentId);
        setEditTitle(res.title);
        setEditPlatform(aiPlatform);
        setEditType(aiType);
        setEditCaption(res.caption);
        setEditScript(slideText);
        setEditCta(res.cta);
        setEditHashtags(res.hashtags.join('، '));
        setEditLanguage(aiLang);
        setEditMediaIds([]);
        setCompHeadline(res.title);
        setCompCta(res.cta);
      } else {
        const tpl = VISUAL_TEMPLATES.find((x) => x.key === visualFormat);
        targetContentId = await createContentItem(business.id, ownerId, {
          title: `تصویر ${tpl?.label || 'خلاقانه'}: ${generatedTitle}`,
          platform: aiPlatform,
          contentType: aiType,
          topic: aiPrompt.slice(0, 280),
          objective: aiObjective,
          language: aiLang,
          caption: '',
          script: '',
          cta: '',
          hashtags: [],
          status: 'draft',
          aiGenerated: true,
          aiModel: preferredImageModelId || imageGenModels[0]?.modelId || 'image-ai',
        });
        loadedItemIdRef.current = targetContentId;
        setSelectedId(targetContentId);
        setEditTitle(`تصویر ${tpl?.label || 'خلاقانه'}: ${generatedTitle}`);
        setEditPlatform(aiPlatform);
        setEditType(aiType);
        setEditCaption('');
        setEditScript('');
        setEditCta('');
        setEditHashtags('');
        setEditLanguage(aiLang);
        setEditMediaIds([]);
        setCompHeadline(generatedTitle);
      }

      if (outputMode === 'text_only') {
        setShowAiPanel(false);
        setAiPrompt('');
        setFeedback('پیش‌نویس متنی با هوش مصنوعی تولید و ذخیره شد.');
        setGenerating(false);
        return;
      }

      const imagePromptParts = [
        aiPrompt.trim(),
        product ? `Featured product: ${product.name}. ${product.description || ''}` : '',
        generatedTitle && outputMode === 'text_and_image' ? `Creative theme: ${generatedTitle}` : '',
      ]
        .filter(Boolean)
        .join('. ');

      await startAsyncImageJobForContent({
        targetContentId,
        promptText: imagePromptParts,
        format: visualFormat,
        ratio: aspectRatio,
        count: numberOfImages,
        headline: generatedTitle,
        ctaText: generatedCta,
      });
      setShowAiPanel(false);
      setAiPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تولید محتوا یا تصویر');
      setGenerating(false);
    }
  };

  const handleGenerateImageForActiveItem = async () => {
    if (!activeItem) return;
    const basePrompt = [editTitle, editCaption.slice(0, 260), activeItem.topic].filter(Boolean).join(' — ');
    if (!basePrompt.trim()) {
      setError('برای تولید تصویر، ابتدا عنوان یا متنی برای این محتوا بنویسید.');
      return;
    }
    setGenerating(true);
    setError(null);
    setFeedback(null);
    setActiveImageJob(null);
    try {
      const targetFmt: VisualFormatKey =
        editType === 'story'
          ? 'story'
          : editType === 'reel_script'
          ? 'reel_cover'
          : editType === 'carousel'
          ? 'carousel_slide'
          : 'square_post';
      const targetRatio: ImageAspectRatio =
        targetFmt === 'story' || targetFmt === 'reel_cover'
          ? '9:16'
          : targetFmt === 'carousel_slide'
          ? '4:5'
          : '1:1';
      await startAsyncImageJobForContent({
        targetContentId: activeItem.id,
        promptText: basePrompt,
        format: targetFmt,
        ratio: targetRatio,
        count: 1,
        headline: editTitle,
        ctaText: editCta,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در شروع تولید تصویر');
      setGenerating(false);
    }
  };

  const handleRegenerateVisual = async (visual: StoredMediaAssetView) => {
    if (!activeItem) return;
    setGenerating(true);
    setError(null);
    setFeedback(null);
    try {
      const fmt: VisualFormatKey = (visual.purpose as VisualFormatKey) || compFormat;
      await startAsyncImageJobForContent({
        targetContentId: activeItem.id,
        promptText: visual.prompt || editTitle || 'تصویر خلاقانه شبکه‌های اجتماعی',
        format: fmt,
        ratio: visual.aspectRatio || '1:1',
        count: 1,
        headline: editTitle,
        ctaText: editCta,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تولید مجدد تصویر');
      setGenerating(false);
    }
  };

  const handleRetryImageJob = async () => {
    if (!activeImageJob) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await retryAiImageJob(activeImageJob.jobId, business);
      setActiveImageJob(res.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تلاش مجدد تولید تصویر');
      setGenerating(false);
    }
  };

  const handleComposeBrandOutput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || !selectedVisual) return;
    setComposing(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await composeBrandImage({
        business,
        sourceMediaId: selectedVisual.id,
        format: compFormat,
        headline: compHeadline.trim() || undefined,
        subheadline: compSubheadline.trim() || undefined,
        ctaText: compCta.trim() || undefined,
        logoMediaId: compLogoId || undefined,
      });
      await syncSavedAssetsToContent(activeItem.id, [res.asset], editMediaIds);
      setVisualActionTab('preview');
      setFeedback('نسخه برندشده با ابعاد دقیق اینستاگرام و تایپوگرافی فارسی ساخته و ذخیره شد (تصویر اصلی حفظ شده است).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ترکیب گرافیکی تصویر با هویت برند');
    } finally {
      setComposing(false);
    }
  };

  const handleEditImageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || !selectedVisual) return;
    if (editImgMode !== 'variation' && !editImgInstruction.trim()) {
      setError('دستور ویرایش تصویر را وارد کنید.');
      return;
    }
    setEditingImg(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await editAiImage({
        business,
        sourceMediaId: selectedVisual.id,
        editMode: editImgMode,
        instruction: editImgInstruction.trim() || 'ایجاد تنوع خلاقانه متناسب با برند',
        aspectRatio: selectedVisual.aspectRatio,
        preferredModelId: editImgModelId || undefined,
      });
      await syncSavedAssetsToContent(activeItem.id, [res.asset], editMediaIds);
      setEditImgInstruction('');
      setVisualActionTab('preview');
      setFeedback(`نسخه ویرایش‌شده جدید (${res.modelUsed}) ذخیره شد و نسخه قبلی دست‌نخورده باقی ماند.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ویرایش تصویر با هوش مصنوعی');
    } finally {
      setEditingImg(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!activeItem) return;
    setSaving(true);
    setError(null);
    try {
      const parsedHashtags = editHashtags
        .split(/[،,\s#]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await updateContentItem(business.id, activeItem.id, {
        title: editTitle,
        platform: editPlatform,
        contentType: editType,
        caption: editCaption,
        script: editScript,
        cta: editCta,
        hashtags: parsedHashtags,
        language: editLanguage,
        mediaIds: editMediaIds,
      });
      setFeedback('تغییرات پیش‌نویس ذخیره شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره محتوا');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!activeItem) return;
    setSaving(true);
    setError(null);
    try {
      await handleSaveEdits();
      await updateContentItem(business.id, activeItem.id, { status: 'in_review' });
      const visualNote =
        activeItemVisuals.length > 0
          ? `\nخروجی‌های تصویری آماده بررسی: ${formatNumber(activeItemVisuals.length, locale, numeralStyle)} فایل (${activeItemVisuals
              .map((v) => `${v.width}×${v.height}`)
              .join('، ')})`
          : '\nبدون فایل تصویری پیوست‌شده';
      await createApprovalRequest(business.id, ownerId, {
        category: 'content_publication',
        actionTitle: `تأیید انتشار: ${editTitle || activeItem.title}`,
        requestingAgentName: activeItem.aiGenerated ? 'ایجنت محتوا' : 'مالک کسب‌وکار',
        targetPlatform: t.platforms[editPlatform],
        reason: 'بررسی و تأیید نهایی متن، تصویر خروجی و پلتفرم مقصد پیش از انتشار',
        payloadSummary: `پلتفرم: ${t.platforms[editPlatform]}\nعنوان: ${editTitle}${visualNote}\n\nکپشن:\n${editCaption}\n\nدعوت به اقدام: ${editCta}`,
        payloadData: {
          contentId: activeItem.id,
          platform: editPlatform,
          contentType: editType,
          mediaIds: editMediaIds,
          visualAssetIds: activeItemVisuals.map((v) => v.id),
        },
        relatedEntityType: 'content',
        relatedEntityId: activeItem.id,
      });
      setFeedback('درخواست تأیید انتشار به همراه مشخصات خروجی تصویری به «مرکز تأییدها» ارسال شد.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ارسال برای تأیید');
    } finally {
      setSaving(false);
    }
  };

  const handleRepurpose = async () => {
    if (!activeItem || repurposeTargets.length === 0) return;
    setRepurposing(true);
    setError(null);
    try {
      const res = await repurposeContentDraft({
        original: activeItem,
        targetPlatforms: repurposeTargets,
        business,
      });
      for (const ver of res.versions) {
        const plat = PLATFORMS.includes(ver.platform) ? ver.platform : 'instagram';
        const ctype = FORMATS.includes(ver.contentType) ? ver.contentType : 'post';
        await createContentItem(business.id, ownerId, {
          title: ver.title,
          platform: plat,
          contentType: ctype,
          language: activeItem.language || 'fa',
          caption: ver.caption,
          script: ver.script,
          cta: ver.cta,
          hashtags: ver.hashtags || [],
          originalContentId: activeItem.id,
          status: 'draft',
          aiGenerated: true,
          aiModel: res.modelUsed || 'gemini-4-hydrogen',
        });
      }
      await logActivity(business.id, ownerId, {
        actorType: 'agent',
        actorName: 'ایجنت محتوا',
        action: 'بازآفرینی محتوا',
        entityType: 'content',
        entityId: activeItem.id,
        details: `${res.versions.length} نسخه جدید برای پلتفرم‌های دیگر ساخته شد.`,
      });
      setShowRepurpose(false);
      setFeedback(`${formatNumber(res.versions.length, locale, numeralStyle)} نسخه بازآفرینی‌شده در استودیو ذخیره شد.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بازآفرینی محتوا');
    } finally {
      setRepurposing(false);
    }
  };

  const filteredContent = content.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
    if (searchQuery.trim() && !c.title.includes(searchQuery.trim()) && !(c.caption || '').includes(searchQuery.trim())) {
      return false;
    }
    return true;
  });

  const counts = {
    total: content.length,
    drafts: content.filter((c) => c.status === 'draft' || c.status === 'idea').length,
    approved: content.filter((c) => c.status === 'approved' || c.status === 'scheduled').length,
    visuals: storedMedia.length,
  };

  const activeEditModelOptions =
    editImgMode === 'variation'
      ? imageVariationModels.length > 0
        ? imageVariationModels
        : imageEditModels
      : imageEditModels;

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="کل محتواها" value={formatNumber(counts.total, locale, numeralStyle)} source="استودیو محتوا" period="کل دوره" />
        <MetricCard label="پیش‌نویس و ایده" value={formatNumber(counts.drafts, locale, numeralStyle)} source="در حال تدوین" period="اکنون" />
        <MetricCard label="تأییدشده / زمان‌بندی" value={formatNumber(counts.approved, locale, numeralStyle)} source="آماده انتشار" period="اکنون" />
        <MetricCard label="خروجی‌های تصویری AI" value={formatNumber(counts.visuals, locale, numeralStyle)} source="کتابخانه پایدار سرور" period="اکنون" />
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجو در عنوان یا کپشن..."
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none w-56"
          />
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          >
            <option value="all">همه پلتفرم‌ها</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{t.platforms[p]}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          >
            <option value="all">همه وضعیت‌ها</option>
            {(['idea', 'draft', 'in_review', 'approved', 'scheduled', 'published'] as ContentStatus[]).map((st) => (
              <option key={st} value={st}>{t.statuses[st]}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateBlank}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#151E33] border border-[#273449] hover:border-[#3B4D6B] text-xs font-medium rounded-lg whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>پیش‌نویس دستی</span>
          </button>
          <button
            onClick={() => setShowAiPanel((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            <span>تولید محتوا و تصویر با هوش مصنوعی</span>
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {feedback && (
        <div className="p-3 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E] flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Active Async Image Job Status */}
      {activeImageJob && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            activeImageJob.status === 'failed'
              ? 'bg-[#EF4444]/10 border-[#EF4444]/40'
              : activeImageJob.status === 'completed'
              ? 'bg-[#22C55E]/10 border-[#22C55E]/30'
              : 'bg-[#151E33] border-[#6366F1]/50'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F8FAFC]">
              {activeImageJob.status !== 'completed' && activeImageJob.status !== 'failed' ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#6366F1]" />
              ) : activeImageJob.status === 'failed' ? (
                <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
              ) : (
                <Check className="w-4 h-4 text-[#22C55E]" />
              )}
              <span>{JOB_STATUS_LABELS[activeImageJob.status]}</span>
              <span className="text-[#94A3B8] font-normal tabular-nums">
                ({formatNumber(activeImageJob.completedCount, locale, numeralStyle)} از{' '}
                {formatNumber(activeImageJob.requestedCount, locale, numeralStyle)} · {activeImageJob.aspectRatio})
              </span>
            </div>

            <div className="flex items-center gap-2">
              {activeImageJob.modelUsed && (
                <span className="text-[11px] text-[#94A3B8] font-mono" dir="ltr">
                  {activeImageJob.providerId}/{activeImageJob.modelUsed}
                </span>
              )}
              {activeImageJob.status === 'failed' && (
                <button
                  type="button"
                  onClick={handleRetryImageJob}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] text-xs text-[#F8FAFC] rounded-lg"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>تلاش مجدد</span>
                </button>
              )}
            </div>
          </div>

          {activeImageJob.status === 'failed' && activeImageJob.errorMessage && (
            <p className="text-xs text-[#EF4444] leading-relaxed">
              {activeImageJob.errorMessage}
              {activeImageJob.errorCode ? ` [${activeImageJob.errorCode}]` : ''}
            </p>
          )}
        </div>
      )}

      {/* AI Generator Panel (Text + Real Image) */}
      {showAiPanel && (
        <form onSubmit={handleAiGenerate} className="bg-[#151E33] border border-[#6366F1]/50 rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">تولید محتوای متنی و تصویری مطابق هویت برند</h3>
            <button type="button" onClick={() => setShowAiPanel(false)} className="text-xs text-[#94A3B8] hover:text-[#F8FAFC]">
              بستن
            </button>
          </div>

          {/* Output Mode Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs text-[#94A3B8]">نوع خروجی درخواستی</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {(
                [
                  { id: 'text_and_image', label: 'متن + تصویر برندشده', desc: 'تولید کپشن/سناریو به همراه تصویر اختصاصی' },
                  { id: 'image_only', label: 'فقط تصویر خلاقانه', desc: 'تولید تصویر واقعی برای پست، استوری یا ریلز' },
                  { id: 'text_only', label: 'فقط متن و سناریو', desc: 'تولید پیش‌نویس متنی در استودیو' },
                ] as Array<{ id: GenerationOutputMode; label: string; desc: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setOutputMode(m.id)}
                  className={`text-right p-3 rounded-lg border transition-colors ${
                    outputMode === m.id
                      ? 'bg-[#6366F1]/15 border-[#6366F1] text-[#F8FAFC]'
                      : 'bg-[#0B1020] border-[#273449] text-[#94A3B8] hover:border-[#3B4D6B]'
                  }`}
                >
                  <div className="text-xs font-semibold">{m.label}</div>
                  <div className="text-[11px] opacity-80 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Visual Templates (when generating images) */}
          {outputMode !== 'text_only' && (
            <div className="space-y-2">
              <label className="block text-xs text-[#94A3B8]">قالب سریع شبکه‌های اجتماعی (تنظیم خودکار ابعاد و فرمت)</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {VISUAL_TEMPLATES.map((tpl) => {
                  const active = visualFormat === tpl.key;
                  return (
                    <button
                      key={tpl.key}
                      type="button"
                      onClick={() => applyTemplate(tpl)}
                      className={`p-2.5 rounded-lg border text-right transition-colors ${
                        active
                          ? 'bg-[#6366F1]/20 border-[#6366F1] text-[#F8FAFC]'
                          : 'bg-[#0B1020] border-[#273449] text-[#94A3B8] hover:border-[#3B4D6B]'
                      }`}
                    >
                      <div className="text-xs font-medium">{tpl.label}</div>
                      <div className="text-[11px] tabular-nums opacity-75 mt-0.5">{tpl.dimensionsLabel}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Core Content Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {outputMode !== 'image_only' && (
              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1">حالت تولید متن</label>
                <select
                  value={aiMode}
                  onChange={(e) => setAiMode(e.target.value as typeof aiMode)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                >
                  <option value="topic">تولید از موضوع</option>
                  <option value="idea">توسعه ایده خام</option>
                  <option value="url">تبدیل لینک یا متن مرجع</option>
                  <option value="improve">بهبود متن موجود</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] text-[#94A3B8] mb-1">پلتفرم مقصد</label>
              <select
                value={aiPlatform}
                onChange={(e) => setAiPlatform(e.target.value as SocialPlatform)}
                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{t.platforms[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#94A3B8] mb-1">فرمت محتوا</label>
              <select
                value={aiType}
                onChange={(e) => setAiType(e.target.value as ContentType)}
                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>{t.contentTypes[f]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#94A3B8] mb-1">زبان</label>
              <select
                value={aiLang}
                onChange={(e) => setAiLang(e.target.value as 'fa' | 'en' | 'ar')}
                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              >
                <option value="fa">فارسی (پیش‌فرض)</option>
                <option value="en">انگلیسی</option>
                <option value="ar">عربی</option>
              </select>
            </div>
            {products.length > 0 && (
              <div>
                <label className="block text-[11px] text-[#94A3B8] mb-1">محصول مرتبط (اختیاری)</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                >
                  <option value="">بدون محصول خاص</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <input
            value={aiObjective}
            onChange={(e) => setAiObjective(e.target.value)}
            placeholder="هدف محتوا (مثلاً: معرفی محصول، افزایش ذخیره و اشتراک‌گذاری)"
            className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
          />

          <textarea
            rows={3}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={
              outputMode === 'image_only'
                ? 'صحنه، سوژه، نورپردازی و فضای بصری مورد نظر خود را به فارسی یا انگلیسی توصیف کنید...'
                : 'موضوع، ایده یا توضیح محتوا و فضای بصری مورد نظر را بنویسید...'
            }
            className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-sm outline-none"
          />

          {/* Image Generation Options */}
          {outputMode !== 'text_only' && (
            <div className="bg-[#0B1020] border border-[#273449] rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[#F8FAFC] flex items-center gap-1.5">
                  <ImageIcon className="w-4 h-4 text-[#6366F1]" />
                  <span>تنظیمات تولید تصویر واقعی</span>
                </div>
                {imageGenModels.length === 0 && !loadingStudioMeta && (
                  <span className="text-[11px] text-[#F59E0B]">
                    هیچ مدل فعال تولید تصویر یافت نشد — از «تنظیمات سرویس‌های هوش مصنوعی» یا پنل ادمین بررسی کنید.
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">سبک بصری</label>
                  <select
                    value={visualStyle}
                    onChange={(e) => setVisualStyle(e.target.value)}
                    className="w-full bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-2 text-xs outline-none"
                  >
                    {VISUAL_STYLES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">نسبت تصویر</label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as ImageAspectRatio)}
                    className="w-full bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-2 text-xs outline-none tabular-nums"
                  >
                    <option value="1:1">1:1 (مربعی ۱۰۸۰×۱۰۸۰)</option>
                    <option value="4:5">4:5 (پرتره / کاروسل ۱۰۸۰×۱۳۵۰)</option>
                    <option value="9:16">9:16 (استوری / ریلز ۱۰۸۰×۱۹۲۰)</option>
                    <option value="16:9">16:9 (افقی ۱۹۲۰×۱۰۸۰)</option>
                    <option value="3:4">3:4 (۱۰۸۰×۱۴۴۰)</option>
                    <option value="4:3">4:3 (۱۴۴۰×۱۰۸۰)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">تعداد خروجی</label>
                  <select
                    value={numberOfImages}
                    onChange={(e) => setNumberOfImages(Number(e.target.value))}
                    className="w-full bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-2 text-xs outline-none"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>{formatNumber(n, locale, numeralStyle)} تصویر</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">کیفیت / وضوح</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as '1K' | '2K' | '4K')}
                    className="w-full bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-2 text-xs outline-none"
                  >
                    {supportedResolutions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-[#94A3B8] mb-1">مدل تولید تصویر</label>
                  <select
                    value={preferredImageModelId}
                    onChange={(e) => setPreferredImageModelId(e.target.value)}
                    className="w-full bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-2 text-xs outline-none"
                  >
                    <option value="">خودکار (بهترین سرویس‌دهنده فعال)</option>
                    {imageGenModels.map((m) => (
                      <option key={m.id} value={m.modelId}>
                        {m.displayName} ({m.providerId})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <input
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="موارد ناخواسته / Negative Prompt (اختیاری، مثلاً: متن به‌هم‌ریخته، واترمارک، نویز)"
                className="w-full bg-[#151E33] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
              />

              {/* Brand Composition Toggle */}
              <div className="border-t border-[#273449] pt-3 space-y-3">
                <label className="flex items-center gap-2 text-xs text-[#F8FAFC] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoBrandOverlay}
                    onChange={(e) => setAutoBrandOverlay(e.target.checked)}
                    className="accent-[#6366F1]"
                  />
                  <span>ترکیب خودکار با هویت برند (رنگ برند، تیتر فارسی استاندارد، CTA و لوگو در خروجی نسخه دوم)</span>
                </label>

                {autoBrandOverlay && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    <input
                      value={overlayHeadline}
                      onChange={(e) => setOverlayHeadline(e.target.value)}
                      placeholder="تیتر روی تصویر (خالی = تیتر خودکار محتوا)"
                      className="bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    />
                    <input
                      value={overlaySubheadline}
                      onChange={(e) => setOverlaySubheadline(e.target.value)}
                      placeholder="زیرتیتر (اختیاری)"
                      className="bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    />
                    <input
                      value={overlayCta}
                      onChange={(e) => setOverlayCta(e.target.value)}
                      placeholder="متن دکمه CTA (اختیاری)"
                      className="bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    />
                    <select
                      value={overlayLogoId}
                      onChange={(e) => setOverlayLogoId(e.target.value)}
                      className="bg-[#151E33] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    >
                      <option value="">بدون درج لوگو</option>
                      {storedMedia.map((m) => (
                        <option key={m.id} value={m.id}>{m.fileName}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={generating || !aiPrompt.trim()}
              className="inline-flex items-center gap-2 px-5 py-2 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>
                {outputMode === 'text_only'
                  ? 'تولید پیش‌نویس متنی'
                  : outputMode === 'image_only'
                  ? 'تولید تصویر واقعی با AI'
                  : 'تولید محتوا و تصویر واقعی'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Split View: Content List + Editor */}
      {content.length === 0 ? (
        <EmptyState
          title="استودیو محتوای شما خالی است"
          description="با کلیک بر «تولید محتوا و تصویر با هوش مصنوعی» یا «پیش‌نویس دستی» اولین محتوای چندرسانه‌ای خود را بسازید."
          actionLabel="ساخت اولین محتوا"
          onAction={() => setShowAiPanel(true)}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Content List */}
          <div className="lg:col-span-5 bg-[#151E33] border border-[#273449] rounded-xl divide-y divide-[#273449] max-h-[820px] overflow-y-auto">
            {filteredContent.map((item) => {
              const selected = activeItem?.id === item.id;
              const linkedIds = new Set(item.mediaIds || []);
              const itemThumb =
                storedMedia.find((s) => s.contentId === item.id) ||
                mediaAssets.find((m) => linkedIds.has(m.id) && m.previewUrl);
              const thumbSrc =
                itemThumb && 'signedUrl' in itemThumb
                  ? itemThumb.signedUrl
                  : itemThumb && 'previewUrl' in itemThumb
                  ? itemThumb.previewUrl
                  : undefined;

              return (
                <div
                  key={item.id}
                  onClick={() => loadIntoEditor(item)}
                  className={`p-4 cursor-pointer transition-colors flex items-center gap-3 ${
                    selected ? 'bg-[#6366F1]/10' : 'hover:bg-[#11182A]'
                  }`}
                >
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt={item.title}
                      className="w-12 h-12 rounded-lg object-cover border border-[#273449] shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-[#0B1020] border border-[#273449] flex items-center justify-center shrink-0 text-[#94A3B8]">
                      <ImageIcon className="w-4 h-4 opacity-50" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-[#F8FAFC] truncate">{item.title}</div>
                      <StatusIndicator status={item.status} label={t.statuses[item.status] || item.status} />
                    </div>
                    <div className="text-xs text-[#94A3B8]">
                      {t.platforms[item.platform]} · {t.contentTypes[item.contentType]}
                      {item.aiGenerated ? ' · تولید AI' : ''}
                      {(item.mediaIds?.length || 0) > 0 ? ` · ${formatNumber(item.mediaIds!.length, locale, numeralStyle)} رسانه` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Content + Visual Studio Editor */}
          <div className="lg:col-span-7 bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-5">
            {!activeItem ? (
              <div className="py-16 text-center text-xs text-[#94A3B8]">
                یک مورد را از فهرست سمت راست برای ویرایش و مدیریت خروجی بصری انتخاب کنید.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#273449] pb-4">
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={activeItem.status} label={t.statuses[activeItem.status]} />
                    {activeItem.aiGenerated && (
                      <span className="text-xs text-[#8B5CF6]">· {t.common.aiGenerated}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateImageForActiveItem}
                      disabled={generating}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6366F1]/15 border border-[#6366F1]/50 hover:bg-[#6366F1]/25 text-xs text-[#F8FAFC] rounded-lg"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-[#6366F1]" />
                      <span>تولید تصویر برای این محتوا</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRepurpose((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#11182A] border border-[#273449] hover:border-[#6366F1] text-xs rounded-lg"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>بازآفرینی</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(activeItem)}
                      className="p-2 text-[#94A3B8] hover:text-[#EF4444]"
                      title="حذف محتوا"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Visual Output Studio Section */}
                <div className="bg-[#0B1020] border border-[#273449] rounded-xl p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#F8FAFC]">
                      <Layers className="w-4 h-4 text-[#6366F1]" />
                      <span>خروجی بصری و گرافیکی محتوا ({formatNumber(activeItemVisuals.length, locale, numeralStyle)})</span>
                    </div>

                    {selectedVisual && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setVisualActionTab('preview')}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium ${
                            visualActionTab === 'preview' ? 'bg-[#6366F1] text-white' : 'bg-[#151E33] text-[#94A3B8]'
                          }`}
                        >
                          پیش‌نمایش و دانلود
                        </button>
                        <button
                          type="button"
                          onClick={() => setVisualActionTab('compose')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium ${
                            visualActionTab === 'compose' ? 'bg-[#6366F1] text-white' : 'bg-[#151E33] text-[#94A3B8]'
                          }`}
                        >
                          <Palette className="w-3 h-3" />
                          <span>ترکیب با برند</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setVisualActionTab('edit')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium ${
                            visualActionTab === 'edit' ? 'bg-[#6366F1] text-white' : 'bg-[#151E33] text-[#94A3B8]'
                          }`}
                        >
                          <Wand2 className="w-3 h-3" />
                          <span>ویرایش و تنوع AI</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {!selectedVisual ? (
                    <div className="py-6 text-center space-y-2.5 border border-dashed border-[#273449] rounded-lg">
                      <p className="text-xs text-[#94A3B8]">
                        هنوز تصویر تولیدشده‌ای به این محتوا متصل نیست.
                      </p>
                      <button
                        type="button"
                        onClick={handleGenerateImageForActiveItem}
                        disabled={generating}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-medium rounded-lg"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>تولید تصویر متناسب با متن و برند</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Multi-Version / Multi-Image Gallery Strip */}
                      {activeItemVisuals.length > 1 && (
                        <div className="flex items-center gap-2 overflow-x-auto pb-1">
                          {activeItemVisuals.map((v) => {
                            const isCurrent = selectedVisual.id === v.id;
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => setSelectedVisualId(v.id)}
                                className={`shrink-0 rounded-lg border p-1 transition-colors text-right ${
                                  isCurrent ? 'border-[#6366F1] bg-[#6366F1]/15' : 'border-[#273449] bg-[#151E33]'
                                }`}
                              >
                                <img
                                  src={v.signedUrl}
                                  alt={v.fileName}
                                  className="w-16 h-16 object-cover rounded"
                                />
                                <div className="text-[10px] text-[#94A3B8] mt-1 px-0.5 tabular-nums">
                                  نسخه {formatNumber(v.versionNumber, locale, numeralStyle)}
                                  {v.composed ? ' · برند' : ''}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Preview & Metadata */}
                      {visualActionTab === 'preview' && (
                        <div className="space-y-3">
                          <div className="bg-[#11182A] border border-[#273449] rounded-lg p-2 flex justify-center">
                            <img
                              src={selectedVisual.signedUrl}
                              alt={selectedVisual.fileName}
                              className="max-h-[420px] w-auto rounded object-contain"
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#94A3B8]">
                            <div className="flex flex-wrap items-center gap-3 tabular-nums">
                              <span>
                                ابعاد: {formatNumber(selectedVisual.width, locale, numeralStyle)}×
                                {formatNumber(selectedVisual.height, locale, numeralStyle)} px
                              </span>
                              <span>نسخه {formatNumber(selectedVisual.versionNumber, locale, numeralStyle)}</span>
                              {selectedVisual.composed && <span className="text-[#8B5CF6]">ترکیب‌شده با هویت برند</span>}
                              {selectedVisual.modelId && (
                                <span dir="ltr" className="font-mono">
                                  {selectedVisual.providerId}/{selectedVisual.modelId}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleRegenerateVisual(selectedVisual)}
                                disabled={generating}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#151E33] border border-[#273449] hover:border-[#6366F1] text-[#F8FAFC] rounded-lg"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>تولید مجدد</span>
                              </button>
                              <a
                                href={`${selectedVisual.signedUrl}&download=1`}
                                download={selectedVisual.fileName}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#6366F1] hover:bg-[#5558E6] text-white rounded-lg"
                              >
                                <Download className="w-3 h-3" />
                                <span>دانلود فایل اصلی</span>
                              </a>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Brand Composition Sub-Panel */}
                      {visualActionTab === 'compose' && (
                        <form onSubmit={handleComposeBrandOutput} className="space-y-3 bg-[#151E33] border border-[#273449] rounded-lg p-3.5">
                          <div className="text-xs text-[#94A3B8]">
                            افزودن تیتر فارسی، زیرتیتر، دکمه فراخوان (CTA)، پالت رنگ برند ({business.brandSettings?.primaryColor || '#6366F1'}) و لوگو روی نسخه جدید با ابعاد دقیق شبکه‌های اجتماعی (فایل اصلی بدون تغییر حفظ می‌شود).
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] text-[#94A3B8] mb-1">قالب خروجی</label>
                              <select
                                value={compFormat}
                                onChange={(e) => setCompFormat(e.target.value as VisualFormatKey)}
                                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                              >
                                <option value="square_post">پست مربعی (۱۰۸۰×۱۰۸۰)</option>
                                <option value="story">استوری اینستاگرام (۱۰۸۰×۱۹۲۰)</option>
                                <option value="reel_cover">کاور ریلز (۱۰۸۰×۱۹۲۰)</option>
                                <option value="carousel_slide">اسلاید کاروسل (۱۰۸۰×۱۳۵۰)</option>
                                <option value="portrait_post">پست پرتره (۱۰۸۰×۱۳۵۰)</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] text-[#94A3B8] mb-1">لوگوی برند (اختیاری)</label>
                              <select
                                value={compLogoId}
                                onChange={(e) => setCompLogoId(e.target.value)}
                                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                              >
                                <option value="">بدون درج لوگو</option>
                                {storedMedia.map((m) => (
                                  <option key={m.id} value={m.id}>{m.fileName}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <input
                            value={compHeadline}
                            onChange={(e) => setCompHeadline(e.target.value)}
                            placeholder="تیتر اصلی فارسی روی تصویر"
                            className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              value={compSubheadline}
                              onChange={(e) => setCompSubheadline(e.target.value)}
                              placeholder="زیرتیتر توضیحی (اختیاری)"
                              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                            />
                            <input
                              value={compCta}
                              onChange={(e) => setCompCta(e.target.value)}
                              placeholder="متن CTA (مثلاً: سفارش از طریق لینک بیو)"
                              className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="submit"
                              disabled={composing}
                              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                            >
                              {composing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Palette className="w-3.5 h-3.5" />}
                              <span>ساخت خروجی برندشده جدید</span>
                            </button>
                          </div>
                        </form>
                      )}

                      {/* AI Image Editing / Variation Sub-Panel */}
                      {visualActionTab === 'edit' && (
                        <form onSubmit={handleEditImageSubmit} className="space-y-3 bg-[#151E33] border border-[#273449] rounded-lg p-3.5">
                          {imageEditModels.length === 0 ? (
                            <div className="text-xs text-[#F59E0B] leading-relaxed">
                              هیچ مدل فعال با قابلیت ویرایش تصویر مرجع (`image_editing`) در تنظیمات سرویس‌دهنده یافت نشد.
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[11px] text-[#94A3B8] mb-1">نوع عملیات ویرایش</label>
                                  <select
                                    value={editImgMode}
                                    onChange={(e) => setEditImgMode(e.target.value as typeof editImgMode)}
                                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                                  >
                                    {EDIT_MODES.map((m) => {
                                      const disabled = m.requiresVariation && imageVariationModels.length === 0 && imageEditModels.length === 0;
                                      return (
                                        <option key={m.key} value={m.key} disabled={disabled}>
                                          {m.label}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] text-[#94A3B8] mb-1">مدل ویرایش تصویر</label>
                                  <select
                                    value={editImgModelId}
                                    onChange={(e) => setEditImgModelId(e.target.value)}
                                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                                  >
                                    <option value="">خودکار</option>
                                    {activeEditModelOptions.map((m) => (
                                      <option key={m.id} value={m.modelId}>
                                        {m.displayName} ({m.providerId})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <textarea
                                rows={2}
                                value={editImgInstruction}
                                onChange={(e) => setEditImgInstruction(e.target.value)}
                                placeholder="توضیح تغییر مورد نظر را بنویسید (مثلاً: پس‌زمینه را به میز چوبی مینیمال با نور پنجره تغییر بده)"
                                className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                              />

                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-[#94A3B8]">
                                  نسخه اصلی حفظ می‌شود و تصویر ویرایش‌شده به عنوان نسخه جدید ذخیره خواهد شد.
                                </span>
                                <button
                                  type="submit"
                                  disabled={editingImg}
                                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-medium rounded-lg shrink-0"
                                >
                                  {editingImg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                                  <span>اعمال ویرایش AI</span>
                                </button>
                              </div>
                            </>
                          )}
                        </form>
                      )}
                    </>
                  )}
                </div>

                {showRepurpose && (
                  <div className="bg-[#11182A] border border-[#273449] rounded-lg p-4 space-y-3">
                    <div className="text-xs font-semibold text-[#F8FAFC]">پلتفرم‌های مقصد را برای ساخت نسخه جدید انتخاب کنید (اصل محتوا بدون تغییر می‌ماند):</div>
                    <div className="flex flex-wrap gap-2">
                      {PLATFORMS.filter((p) => p !== activeItem.platform).map((p) => {
                        const checked = repurposeTargets.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() =>
                              setRepurposeTargets((prev) =>
                                checked ? prev.filter((x) => x !== p) : [...prev, p]
                              )
                            }
                            className={`px-3 py-1 rounded-lg border text-xs ${
                              checked ? 'bg-[#6366F1] border-[#6366F1] text-white' : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                            }`}
                          >
                            {t.platforms[p]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setShowRepurpose(false)} className="text-xs text-[#94A3B8] px-3 py-1.5">انصراف</button>
                      <button
                        type="button"
                        onClick={handleRepurpose}
                        disabled={repurposing || repurposeTargets.length === 0}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#6366F1] text-white text-xs font-medium rounded-lg"
                      >
                        {repurposing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>ساخت نسخه‌های جدید</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block text-xs text-[#94A3B8] mb-1">عنوان</label>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">پلتفرم</label>
                    <select
                      value={editPlatform}
                      onChange={(e) => setEditPlatform(e.target.value as SocialPlatform)}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    >
                      {PLATFORMS.map((p) => (
                        <option key={p} value={p}>{t.platforms[p]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">فرمت</label>
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as ContentType)}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    >
                      {FORMATS.map((f) => (
                        <option key={f} value={f}>{t.contentTypes[f]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">زبان</label>
                    <select
                      value={editLanguage}
                      onChange={(e) => setEditLanguage(e.target.value as 'fa' | 'en' | 'ar')}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    >
                      <option value="fa">فارسی</option>
                      <option value="en">انگلیسی</option>
                      <option value="ar">عربی</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-[#94A3B8]">کپشن / متن اصلی</label>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(editCaption)}
                      className="inline-flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-[#F8FAFC]"
                    >
                      <Copy className="w-3 h-3" />
                      <span>کپی کپشن</span>
                    </button>
                  </div>
                  <textarea
                    rows={5}
                    dir={editLanguage === 'en' ? 'ltr' : 'rtl'}
                    value={editCaption}
                    onChange={(e) => setEditCaption(e.target.value)}
                    className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm leading-relaxed outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#94A3B8] mb-1">سناریو / اسلایدها</label>
                  <textarea
                    rows={4}
                    dir={editLanguage === 'en' ? 'ltr' : 'rtl'}
                    value={editScript}
                    onChange={(e) => setEditScript(e.target.value)}
                    className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm leading-relaxed outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">فراخوان به اقدام (CTA)</label>
                    <input
                      value={editCta}
                      onChange={(e) => setEditCta(e.target.value)}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1">هشتگ‌ها (با ویرگول یا فاصله جدا کنید)</label>
                    <input
                      value={editHashtags}
                      onChange={(e) => setEditHashtags(e.target.value)}
                      className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                    />
                  </div>
                </div>

                {mediaAssets.length > 0 && (
                  <div>
                    <label className="block text-xs text-[#94A3B8] mb-1.5">پیوست از کتابخانه رسانه</label>
                    <div className="flex flex-wrap gap-2">
                      {mediaAssets.slice(0, 10).map((m) => {
                        const attached = editMediaIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() =>
                              setEditMediaIds((prev) =>
                                attached ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                              )
                            }
                            className={`px-2.5 py-1 rounded border text-[11px] ${
                              attached ? 'bg-[#6366F1]/20 border-[#6366F1] text-[#F8FAFC]' : 'bg-[#0B1020] border-[#273449] text-[#94A3B8]'
                            }`}
                          >
                            {m.fileName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-[#273449]">
                  <button
                    type="button"
                    onClick={handleSaveEdits}
                    disabled={saving}
                    className="px-4 py-2 bg-[#11182A] border border-[#273449] hover:border-[#3B4D6B] text-xs font-medium rounded-lg"
                  >
                    ذخیره پیش‌نویس
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitForApproval}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>ارسال به مرکز تأییدها</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="حذف محتوا"
        description={t.common.confirmDelete}
        confirmLabel="حذف دائمی"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteContentItem(business.id, deleteTarget.id);
            if (selectedId === deleteTarget.id) setSelectedId(null);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
