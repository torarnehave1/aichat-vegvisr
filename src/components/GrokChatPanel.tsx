import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, Upload } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useLanguage } from '../lib/LanguageContext';
import { useTranslation } from '../lib/useTranslation';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  imageData?: {
    base64Data?: string | null;
    previewImageUrl?: string | null;
    mimeType?: string;
    revisedPrompt?: string | null;
    imageType?: string;
    originalPrompt?: string;
    fullImageUrl?: string | null;
    model?: string;
    prompt?: string;
    size?: string;
    quality?: string;
  };
};

type UploadedImage = {
  file: File | null;
  preview: string;
  base64: string | null;
  mimeType: string;
  sourceUrl?: string;
  isUrlOnly?: boolean;
};

type AudioFileInfo = {
  file: File;
  name: string;
  size: number;
  type: string;
  duration: number | null;
};

const extractFirstUrl = (text: string) => {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
};

const getImagePreviewUrl = (imageData?: ChatMessage['imageData']) => {
  if (!imageData) return null;
  if (imageData.base64Data) {
    const mimeType = imageData.mimeType || 'image/png';
    return `data:${mimeType};base64,${imageData.base64Data}`;
  }
  if (imageData.previewImageUrl) return imageData.previewImageUrl;
  return null;
};

const getFullImageUrl = (imageData?: ChatMessage['imageData']) =>
  imageData?.fullImageUrl || imageData?.previewImageUrl || null;

const MAX_PERSIST_BASE64_LENGTH = 900000;

const compressBase64Image = (
  base64: string,
  mimeType: string,
  maxDimension = 1024,
  quality = 0.82
): Promise<{ base64: string; mimeType: string } | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const compressedBase64 = dataUrl.split(',')[1] || '';
      resolve({ base64: compressedBase64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => resolve(null);
    img.src = `data:${mimeType || 'image/png'};base64,${base64}`;
  });

const toBase64FromUrl = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const blob = await response.blob();
  const mimeType = blob.type || 'image/png';
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1] || '');
      } else {
        reject(new Error('Unable to read image'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read image'));
    reader.readAsDataURL(blob);
  });
  return { base64, mimeType };
};

const MarkdownMessage = ({
  content,
  textClassName
}: {
  content: string;
  textClassName: string;
}) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeSanitize]}
    components={{
      p: ({ children }) => <p className={`mb-3 last:mb-0 leading-relaxed ${textClassName}`}>{children}</p>,
      ul: ({ children }) => <ul className={`mb-3 list-disc space-y-1 pl-5 ${textClassName}`}>{children}</ul>,
      ol: ({ children }) => <ol className={`mb-3 list-decimal space-y-1 pl-5 ${textClassName}`}>{children}</ol>,
      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
      em: ({ children }) => <em className="text-slate-800">{children}</em>,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-sky-700 underline underline-offset-4 hover:text-sky-800"
        >
          {children}
        </a>
      ),
      code: ({ className, children }) =>
        !className ? (
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
            {children}
          </code>
        ) : (
          <code className="block font-mono text-xs text-slate-900">{children}</code>
        ),
      pre: ({ children }) => (
        <pre className="mb-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900">
          {children}
        </pre>
      ),
      h1: ({ children }) => <h1 className="mb-3 text-lg font-semibold text-slate-900">{children}</h1>,
      h2: ({ children }) => <h2 className="mb-2 text-base font-semibold text-slate-900">{children}</h2>,
      h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold text-slate-900">{children}</h3>,
      blockquote: ({ children }) => (
        <blockquote className="mb-3 border-l-2 border-slate-300 pl-3 text-slate-700">
          {children}
        </blockquote>
      )
    }}
  >
    {content}
  </ReactMarkdown>
);

const providerOptions = [
  { value: 'grok', label: 'Grok' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'perplexity', label: 'Perplexity' }
];

const openaiModelOptions = [
  { value: 'gpt-image-1.5', label: 'GPT-Image-1.5 (Image Gen)' },
  { value: 'gpt-image-1', label: 'GPT-Image-1 (Image Gen)' },
  { value: 'gpt-image-1-mini', label: 'GPT-Image-1 Mini (Image Gen)' },
  { value: 'gpt-5.2', label: 'GPT-5.2 (Chat/Text)' },
  { value: 'gpt-5.1', label: 'GPT-5.1 (Chat/Text)' },
  { value: 'gpt-5', label: 'GPT-5 (Chat/Text)' },
  { value: 'gpt-4o', label: 'GPT-4o (Chat/Text)' },
  { value: 'gpt-4', label: 'GPT-4 (Chat/Text)' }
];

const claudeModelOptions = [
  { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
];

const providerLabel = (value: string) =>
  providerOptions.find((option) => option.value === value)?.label ?? 'AI';

const CHAT_ENDPOINTS: Record<string, string> = {
  grok: 'https://grok.vegvisr.org/chat',
  openai: 'https://openai.vegvisr.org/chat',
  claude: 'https://anthropic.vegvisr.org/chat',
  gemini: 'https://gemini.vegvisr.org/chat',
  perplexity: 'https://perplexity.vegvisr.org/chat'
};

const CHAT_HISTORY_BASE_URL = 'https://api.vegvisr.org/chat-history';
const AUDIO_ENDPOINT = 'https://openai.vegvisr.org/audio';
const HTML_IMPORT_ENDPOINT = '/api/import-html';
const GRAPH_CLONE_HTML_NODE_ENDPOINT = '/api/graph/clone-html-node';
const GRAPH_ATTACH_STYLES_ENDPOINT = '/api/graph/attach-styles';
const GRAPH_DETACH_STYLES_ENDPOINT = '/api/graph/detach-styles';
const GRAPH_GET_ENDPOINT = '/api/graph/getknowgraph';
const GRAPH_THEME_CATALOG_ENDPOINT = '/api/graph/theme-graphs';
const GRAPH_APPLY_THEME_TEMPLATE_ENDPOINT = '/api/graph/apply-theme-template';
const GRAPH_APPLY_THEME_TEMPLATE_BULK_ENDPOINT = '/api/graph/apply-theme-template-bulk';
const GRAPH_VALIDATE_THEME_CONTRACT_ENDPOINT = '/api/graph/validate-theme-contract';
const GRAPH_CREATE_THEME_PAGE_NODE_ENDPOINT = '/api/graph/create-theme-page-node';
const THEME_CREATE_FROM_URL_ENDPOINT = '/api/theme/create-from-url';
const RESUME_SESSION_ON_LOAD = false;
const GRAPH_IDENTIFIER = 'graph_1768629904479';
const THEME_GRAPH_SOURCE_ID = '980a2d35-0a17-426d-a0f4-db24a7b27090';
const CHUNK_DURATION_SECONDS = 120;

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/ogg; codecs=opus',
  'audio/opus',
  'audio/webm',
  'video/mp4',
  'video/webm'
]);

const SUPPORTED_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.mp4', '.webm'];

const THEME_CONTRACT_CLASSES = [
  'v-page',
  'v-container',
  'v-section',
  'v-grid',
  'v-card',
  'v-title',
  'v-text',
  'v-btn'
];

const CUSTOM_THEME_STORAGE_KEY_PREFIX = 'aichat-vegvisr:theme-studio:custom-themes:v1';

type ThemeTemplate = {
  id: string;
  label: string;
  description: string;
  tags: string[];
  swatches: string[];
  // If present, Theme Studio renders this HTML directly (matching the theme page in the graph).
  // Used for "free" themes that are full HTML pages, not contract-driven previews.
  sourceHtml?: string;
  fontFamily?: string;
  googleFontImportUrl?: string;
  palette?: Array<{ name: string; hex: string }>;
  tokens: {
    bg: string;
    surface: string;
    surfaceElevated: string;
    text: string;
    muted: string;
    primary: string;
    primaryInk: string;
    border: string;
    radius: string;
    shadow: string;
  };
  ownerUserId?: string;
  ownerEmail?: string | null;
  visibility?: 'shared' | 'private';
  createdAt?: string | null;
  updatedAt?: string | null;
  sourceGraphId?: string | null;
  sourceHtmlNodeId?: string | null;
};

type ThemeFilterScope = 'all' | 'mine' | 'shared';
type ThemeSortMode = 'newest' | 'most-used' | 'mine-first';
type SettingsTab = 'assistant' | 'import' | 'theme';
type ThemeGraphCatalogItem = {
  id: string;
  title: string;
  updatedAt?: string;
  createdBy?: string;
};

type GraphNode = {
  id: string;
  label?: string;
  info?: string;
  type?: string;
  updatedAt?: string;
  createdAt?: string;
  metadata?: Record<string, any>;
};

type GraphEdge = {
  id?: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
};

type GraphData = {
  nodes: GraphNode[];
  edges?: GraphEdge[];
};

const extractFirstMatch = (text: string, pattern: RegExp) => {
  const match = text.match(pattern);
  return match ? String(match[1] || '').trim() : '';
};

const collectInlineCss = (html: string) => {
  let css = '';
  html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_match, content) => {
    css += String(content || '') + '\n';
    return '';
  });
  return css;
};

const collectCssNodesForHtmlNode = (htmlNodeId: string, graphData: GraphData): GraphNode[] => {
  const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
  const edges = Array.isArray(graphData?.edges) ? graphData.edges : [];
  const cssNodes = nodes.filter((node) => String(node?.type || '').toLowerCase() === 'css-node');

  const styleEdges = edges.filter((edge) => {
    const edgeType = String(edge?.label || edge?.type || '').toLowerCase();
    return edgeType === 'styles';
  });

  const cssNodeIdsFromEdges = new Set(
    styleEdges
      .filter((edge) => edge?.target === htmlNodeId && edge?.source)
      .map((edge) => edge.source)
  );

  const applicableCss = cssNodes.filter((node) => {
    const appliesTo = Array.isArray(node?.metadata?.appliesTo) ? node.metadata.appliesTo : [];
    return cssNodeIdsFromEdges.has(node.id) || appliesTo.includes(htmlNodeId) || appliesTo.includes('*');
  });

  applicableCss.sort((a, b) => (Number(a?.metadata?.priority ?? 999) as number) - (Number(b?.metadata?.priority ?? 999) as number));
  return applicableCss;
};

const injectCssNodesIntoHtml = (htmlContent: string, htmlNodeId: string, graphData: GraphData) => {
  const cssNodes = collectCssNodesForHtmlNode(htmlNodeId, graphData);
  if (!cssNodes.length) return htmlContent;

  let cssInjection = '<!-- CSS Nodes Injected by Vegvisr -->\\n';
  for (const cssNode of cssNodes) {
    const priority = Number(cssNode?.metadata?.priority ?? 999);
    cssInjection += `<style data-css-node-id="${cssNode.id}" data-css-node-label="${String(
      cssNode.label || ''
    ).replace(/"/g, '&quot;')}" data-css-priority="${priority}">\\n`;
    cssInjection += `/* CSS Node: ${cssNode.label || cssNode.id} (Priority: ${priority}) */\\n`;
    cssInjection += String(cssNode.info || '');
    cssInjection += '\\n</style>\\n';
  }

  if (htmlContent.includes('</head>')) return htmlContent.replace('</head>', cssInjection + '</head>');
  if (htmlContent.includes('<head>')) return htmlContent.replace('<head>', '<head>\\n' + cssInjection);
  return cssInjection + htmlContent;
};

const findCssVar = (cssText: string, varName: string) => {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return extractFirstMatch(cssText, new RegExp(`${escaped}\\s*:\\s*([^;]+);`, 'i'));
};

const extractGoogleFontUrl = (html: string, cssText: string) => {
  const linkHref = extractFirstMatch(
    html,
    /<link[^>]+href=["'](https:\/\/fonts\.googleapis\.com\/css2?[^"']+)["'][^>]*>/i
  );
  if (linkHref) return linkHref;
  const importUrl = extractFirstMatch(
    cssText,
    /@import\s+url\(["']?(https:\/\/fonts\.googleapis\.com\/css2?[^"')]+)["']?\)\s*;/i
  );
  return importUrl;
};

const extractHexColors = (text: string, max = 10) => {
  const matches = text.match(/#[0-9a-fA-F]{6}\b/g) || [];
  const unique: string[] = [];
  for (const item of matches) {
    const normalized = item.toLowerCase();
    if (!unique.includes(normalized)) unique.push(normalized);
    if (unique.length >= max) break;
  }
  return unique;
};

const buildThemeFromHtmlNode = (node: GraphNode, sourceGraphId: string, graphData: GraphData): ThemeTemplate | null => {
  const rawHtml = String(node.info || '');
  const label = String(node.label || '').trim();
  if (!rawHtml || !label) return null;
  if (!rawHtml.toLowerCase().includes('<html') && !rawHtml.toLowerCase().includes('<!doctype')) return null;

  // Mirror the html-node rendering behavior from GNewViewer:
  // - replace {{GRAPH_ID}}
  // - inject applicable css-node(s) via styles edges / metadata.appliesTo
  let html = rawHtml;
  html = html.replace(/\{\{GRAPH_ID\}\}/g, sourceGraphId);
  html = injectCssNodesIntoHtml(html, node.id, graphData);

  const cssText = collectInlineCss(html);
  const dataTheme = extractFirstMatch(html, /data-v-theme=["']([^"']+)["']/i);
  const themeId = normalizeThemeId(dataTheme || label || node.id);
  if (!themeId) return null;

  const googleFontImportUrl = extractGoogleFontUrl(html, cssText) || undefined;
  const hexes = extractHexColors(html + '\n' + cssText, 8);
  const fallback = {
    bg: hexes[0] || '#0b1220',
    surface: hexes[1] || '#0f172a',
    surfaceElevated: hexes[1] || '#0f172a',
    text: hexes[2] || '#ffffff',
    muted: hexes[3] || '#94a3b8',
    primary: hexes[4] || '#22d3ee',
    primaryInk: '#ffffff',
    border: '#334155',
    radius: '18px',
    shadow: '0 22px 50px rgba(15, 23, 42, 0.4)'
  };

  const tokens = {
    bg: findCssVar(cssText, '--v-bg') || fallback.bg,
    surface: findCssVar(cssText, '--v-surface') || fallback.surface,
    surfaceElevated: findCssVar(cssText, '--v-surface-elevated') || fallback.surfaceElevated,
    text: findCssVar(cssText, '--v-text') || fallback.text,
    muted: findCssVar(cssText, '--v-muted') || fallback.muted,
    primary: findCssVar(cssText, '--v-primary') || fallback.primary,
    primaryInk: findCssVar(cssText, '--v-primary-ink') || fallback.primaryInk,
    border: findCssVar(cssText, '--v-border') || fallback.border,
    radius: findCssVar(cssText, '--v-radius') || fallback.radius,
    shadow: findCssVar(cssText, '--v-shadow') || fallback.shadow
  };

  const swatches = [tokens.bg, tokens.surface, tokens.text, tokens.muted, tokens.primary].filter(Boolean);

  return {
    id: themeId,
    label,
    description: 'Theme loaded from a Theme Graph.',
    tags: ['theme', 'graph', 'theme-page'],
    swatches: swatches.slice(0, 5),
    sourceHtml: html,
    googleFontImportUrl,
    tokens,
    visibility: 'shared',
    updatedAt: node.updatedAt || node.createdAt || null,
    createdAt: node.createdAt || null,
    sourceGraphId,
    sourceHtmlNodeId: node.id || null
  };
};

const BUILT_IN_THEME_TEMPLATES: ThemeTemplate[] = [
  {
    id: 'nordic-light',
    label: 'Nordic Light',
    description: 'Clean and bright product style.',
    tags: ['light', 'neutral', 'product'],
    swatches: ['#f8fafc', '#ffffff', '#0f172a', '#475569', '#0ea5e9'],
    fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif",
    googleFontImportUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
    tokens: {
      bg: '#f8fafc',
      surface: '#ffffff',
      surfaceElevated: '#f1f5f9',
      text: '#0f172a',
      muted: '#475569',
      primary: '#0ea5e9',
      primaryInk: '#ffffff',
      border: '#cbd5e1',
      radius: '16px',
      shadow: '0 20px 45px rgba(15, 23, 42, 0.08)'
    }
  },
  {
    id: 'coastal-blue',
    label: 'Coastal Blue',
    description: 'Calm blue palette for landing pages.',
    tags: ['blue', 'marketing', 'light'],
    swatches: ['#f0f9ff', '#ffffff', '#082f49', '#075985', '#0284c7'],
    fontFamily: "'Manrope', -apple-system, 'Segoe UI', sans-serif",
    googleFontImportUrl: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap',
    tokens: {
      bg: '#f0f9ff',
      surface: '#ffffff',
      surfaceElevated: '#e0f2fe',
      text: '#082f49',
      muted: '#075985',
      primary: '#0284c7',
      primaryInk: '#f8fafc',
      border: '#7dd3fc',
      radius: '18px',
      shadow: '0 18px 40px rgba(2, 132, 199, 0.18)'
    }
  },
  {
    id: 'forest-minimal',
    label: 'Forest Minimal',
    description: 'Natural green palette with soft contrast.',
    tags: ['green', 'minimal', 'nature'],
    swatches: ['#f7fee7', '#ffffff', '#14532d', '#365314', '#4d7c0f'],
    fontFamily: "'Lora', Georgia, serif",
    googleFontImportUrl: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&display=swap',
    tokens: {
      bg: '#f7fee7',
      surface: '#ffffff',
      surfaceElevated: '#ecfccb',
      text: '#14532d',
      muted: '#365314',
      primary: '#4d7c0f',
      primaryInk: '#f7fee7',
      border: '#bef264',
      radius: '16px',
      shadow: '0 16px 36px rgba(77, 124, 15, 0.18)'
    }
  },
  {
    id: 'sunset-coral',
    label: 'Sunset Coral',
    description: 'Warm and conversion-focused accent styling.',
    tags: ['warm', 'coral', 'bold'],
    swatches: ['#fff7ed', '#ffffff', '#7c2d12', '#9a3412', '#ea580c'],
    fontFamily: "'Poppins', -apple-system, 'Segoe UI', sans-serif",
    googleFontImportUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap',
    tokens: {
      bg: '#fff7ed',
      surface: '#ffffff',
      surfaceElevated: '#ffedd5',
      text: '#7c2d12',
      muted: '#9a3412',
      primary: '#ea580c',
      primaryInk: '#fff7ed',
      border: '#fdba74',
      radius: '18px',
      shadow: '0 20px 42px rgba(234, 88, 12, 0.2)'
    }
  },
  {
    id: 'midnight-contrast',
    label: 'Midnight Contrast',
    description: 'Dark UI with strong CTA contrast.',
    tags: ['dark', 'saas', 'contrast'],
    swatches: ['#020617', '#0f172a', '#e2e8f0', '#94a3b8', '#22d3ee'],
    fontFamily: "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
    googleFontImportUrl:
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap',
    tokens: {
      bg: '#020617',
      surface: '#0f172a',
      surfaceElevated: '#1e293b',
      text: '#e2e8f0',
      muted: '#94a3b8',
      primary: '#22d3ee',
      primaryInk: '#0f172a',
      border: '#334155',
      radius: '16px',
      shadow: '0 22px 50px rgba(15, 23, 42, 0.4)'
    }
  }
];

const normalizeThemeSearch = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-');

const normalizeThemeId = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const extractJsonObjectFromText = (rawText: string) => {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const candidates: string[] = [];
  candidates.push(text);

  const fenceMatch = text.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
  if (fenceMatch?.[1]) {
    candidates.unshift(fenceMatch[1].trim());
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }

    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const slice = candidate.slice(first, last + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // continue
      }
    }
  }

  return null;
};

const resolveThemeTemplateInCatalog = (value: string, catalog: ThemeTemplate[]): ThemeTemplate | null => {
  const needle = normalizeThemeSearch(value);
  if (!needle) return null;
  for (const theme of catalog) {
    if (theme.id === needle) return theme;
    if (normalizeThemeSearch(theme.label) === needle) return theme;
    if (theme.tags.some((tag) => normalizeThemeSearch(tag) === needle)) return theme;
  }
  const loose = catalog.find((theme) =>
    [theme.id, theme.label, ...theme.tags]
      .map((item) => normalizeThemeSearch(item))
      .some((candidate) => candidate.includes(needle))
  );
  return loose || null;
};

const resolveThemeFont = (theme: ThemeTemplate) => ({
  fontFamily: theme.fontFamily || "'Inter', -apple-system, 'Segoe UI', sans-serif",
  googleFontImportUrl:
    theme.googleFontImportUrl ||
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
});

const buildThemeTemplateCss = (theme: ThemeTemplate) => {
  const t = theme.tokens;
  const font = resolveThemeFont(theme);
  return `:root, html[data-v-theme="${theme.id}"] {
  --v-bg: ${t.bg};
  --v-surface: ${t.surface};
  --v-surface-elevated: ${t.surfaceElevated};
  --v-text: ${t.text};
  --v-muted: ${t.muted};
  --v-primary: ${t.primary};
  --v-primary-ink: ${t.primaryInk};
  --v-border: ${t.border};
  --v-radius: ${t.radius};
  --v-shadow: ${t.shadow};
  --v-font: ${font.fontFamily};
}
html[data-v-theme="${theme.id}"], html[data-v-theme="${theme.id}"] body {
  background: var(--v-bg);
  color: var(--v-text);
  font-family: var(--v-font);
}
.v-page { min-height: 100vh; background: var(--v-bg); color: var(--v-text); font-family: var(--v-font); }
.v-container { width: min(1120px, 92vw); margin: 0 auto; }
.v-section { padding: clamp(20px, 4vw, 36px) 0; }
.v-grid { display: grid; gap: 12px; }
.v-card { background: var(--v-surface); border: 1px solid var(--v-border); border-radius: var(--v-radius); box-shadow: var(--v-shadow); padding: 14px; }
.v-title { color: var(--v-text); line-height: 1.2; }
.v-text { color: var(--v-muted); line-height: 1.5; }
.v-btn { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--v-border); border-radius: calc(var(--v-radius) - 6px); background: var(--v-primary); color: var(--v-primary-ink); padding: 8px 12px; text-decoration: none; font-weight: 600; }`;
};

const extractThemeFromCss = ({
  cssText,
  baseId,
  label
}: {
  cssText: string;
  baseId: string;
  label: string;
}): ThemeTemplate => {
  const css = String(cssText || '');
  const varValue = (name: string) => {
    const match = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'i'));
    return match ? match[1].trim() : '';
  };
  const propValue = (prop: string) => {
    const match = css.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`, 'i'));
    return match ? match[1].trim() : '';
  };
  const firstColor = (fallback: string) => {
    const matches = css.match(/#(?:[0-9a-fA-F]{3,8})\b/g) || [];
    return matches[0] || fallback;
  };
  const allColors = Array.from(new Set(css.match(/#(?:[0-9a-fA-F]{3,8})\b/g) || []));

  const bg = varValue('v-bg') || varValue('background') || firstColor('#f8fafc');
  const surface = varValue('v-surface') || varValue('surface') || allColors[1] || '#ffffff';
  const surfaceElevated = varValue('v-surface-elevated') || allColors[2] || '#f1f5f9';
  const text = varValue('v-text') || varValue('text') || allColors[3] || '#0f172a';
  const muted = varValue('v-muted') || allColors[4] || '#475569';
  const primary = varValue('v-primary') || allColors[5] || '#0ea5e9';
  const primaryInk = varValue('v-primary-ink') || '#ffffff';
  const border = varValue('v-border') || allColors[6] || '#cbd5e1';
  const radius = varValue('v-radius') || propValue('border-radius') || '16px';
  const shadow = varValue('v-shadow') || propValue('box-shadow') || '0 20px 45px rgba(15, 23, 42, 0.08)';
  const fontFamily = varValue('v-font') || propValue('font-family') || "'Inter', -apple-system, 'Segoe UI', sans-serif";

  const id = normalizeThemeId(baseId) || `graph-theme-${Date.now()}`;
  const finalLabel = label.trim() || 'Imported Graph Theme';
  const swatches = [bg, surface, text, muted, primary].filter(Boolean);

  return {
    id,
    label: finalLabel,
    description: 'Theme imported from graph CSS node.',
    tags: ['imported', 'graph-theme'],
    swatches,
    fontFamily,
    googleFontImportUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
    tokens: {
      bg,
      surface,
      surfaceElevated,
      text,
      muted,
      primary,
      primaryInk,
      border,
      radius,
      shadow
    },
    visibility: 'shared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
};

const buildThemePreviewHtml = (
  theme: ThemeTemplate,
  options?: { variant?: 'card' | 'modal'; imageUrl?: string | null }
) => {
  const variant = options?.variant || 'card';
  const imageUrl = options?.imageUrl || '';
  const cardMode = variant === 'card';
  const previewGridCols = cardMode ? '1fr 1fr' : '1.2fr 1fr';
  const previewTitleSize = cardMode ? '13px' : '20px';
  const previewTextSize = cardMode ? '11px' : '14px';
  const previewBtnSize = cardMode ? '10px' : '13px';
  const imageHeight = cardMode ? '88px' : '220px';
  const font = resolveThemeFont(theme);
  const imageBlock = imageUrl
    ? `<div class="preview-image-wrap v-card">
         <img class="preview-image" src="${imageUrl}" alt="Theme preview image" />
       </div>`
    : '';

  return `<!DOCTYPE html>
<html data-v-theme="${theme.id}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="${font.googleFontImportUrl}" rel="stylesheet" />
    <style>
      html, body { margin: 0; padding: 0; font-family: ${font.fontFamily}; }
      ${buildThemeTemplateCss(theme)}
      .preview-root { padding: 8px; }
      .preview-grid { grid-template-columns: ${previewGridCols}; align-items: stretch; }
      .preview-title { font-size: ${previewTitleSize}; margin: 0 0 6px; }
      .preview-text { font-size: ${previewTextSize}; margin: 0 0 10px; }
      .preview-btn { font-size: ${previewBtnSize}; padding: 7px 12px; }
      .preview-image-wrap { padding: 6px; overflow: hidden; }
      .preview-image { width: 100%; height: ${imageHeight}; object-fit: cover; border-radius: calc(var(--v-radius) - 8px); display: block; }
      .preview-lorem { margin: 0; }
    </style>
  </head>
  <body class="v-page">
    <div class="preview-root v-container">
      <section class="v-section">
        <div class="v-grid preview-grid">
          <article class="v-card">
            <h3 class="v-title preview-title">Theme Preview</h3>
            <p class="v-text preview-text preview-lorem">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras dictum, arcu vel pulvinar viverra, purus mauris mattis est.</p>
            <a class="v-btn preview-btn" href="#">Button</a>
          </article>
          <article class="v-card">
            <h3 class="v-title preview-title">${theme.label}</h3>
            <p class="v-text preview-text">${theme.tags.join(' · ') || 'theme · ui'}</p>
            <a class="v-btn preview-btn" href="#">Action</a>
          </article>
          ${imageBlock}
        </div>
      </section>
    </div>
  </body>
</html>`;
};

type GrokChatPanelProps = {
  initialUserId?: string;
  initialEmail?: string;
};

type LocalGraphCommandResult = {
  handled: boolean;
  response?: string;
};

const GrokChatPanel = ({ initialUserId, initialEmail }: GrokChatPanelProps) => {
  const { language } = useLanguage();
  const t = useTranslation(language);
  const [provider, setProvider] = useState('grok');
  const [openaiModel, setOpenaiModel] = useState('gpt-5.2');
  const [claudeModel, setClaudeModel] = useState('claude-opus-4-5-20251101');
  const [userId, setUserId] = useState(initialUserId || '');
  const [userEmail, setUserEmail] = useState(initialEmail || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [useGraphContext, setUseGraphContext] = useState(true);
  const [useSelectionContext, setUseSelectionContext] = useState(false);
  const [useProffTools, setUseProffTools] = useState(false);
  const [useSourcesTools, setUseSourcesTools] = useState(false);
  const [useTemplateTools, setUseTemplateTools] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [selectedAudioFile, setSelectedAudioFile] = useState<AudioFileInfo | null>(null);
  const [audioProcessing, setAudioProcessing] = useState(false);
  const [audioTranscriptionStatus, setAudioTranscriptionStatus] = useState('');
  const [audioChunkProgress, setAudioChunkProgress] = useState({ current: 0, total: 0 });
  const [audioAutoDetect, setAudioAutoDetect] = useState(true);
  const [audioLanguage, setAudioLanguage] = useState('no');
  const [isDragOver, setIsDragOver] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('assistant');
  const [imageLoadStates, setImageLoadStates] = useState<Record<string, boolean>>({});
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const providerSupportsImages = provider !== 'grok';
  const isOpenAIImageModel = provider === 'openai' && openaiModel.startsWith('gpt-image');
  const [responseFontSize, setResponseFontSize] = useState<'sm' | 'md' | 'lg'>('md');
  const canPersistHistory = Boolean(userId.trim());
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyLastLoaded, setHistoryLastLoaded] = useState<string | null>(null);
  const [availableSessions, setAvailableSessions] = useState<Array<{ id: string; title?: string; updatedAt?: string }>>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [deleteSessionError, setDeleteSessionError] = useState('');
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [htmlImportOpen, setHtmlImportOpen] = useState(false);
  const [htmlImportUrl, setHtmlImportUrl] = useState('');
  const [htmlImportTitle, setHtmlImportTitle] = useState('');
  const [htmlImportDescription, setHtmlImportDescription] = useState('');
  const [htmlImportMode, setHtmlImportMode] = useState<'new' | 'current'>('new');
  const [htmlImportTargetGraphId, setHtmlImportTargetGraphId] = useState(GRAPH_IDENTIFIER);
  const [htmlImportLoading, setHtmlImportLoading] = useState(false);
  const [htmlImportError, setHtmlImportError] = useState('');
  const [htmlImportGraphId, setHtmlImportGraphId] = useState<string | null>(null);
  const [htmlImportStats, setHtmlImportStats] = useState<{
    cssBytes?: number;
    htmlBytes?: number;
    payloadBytes?: number;
  } | null>(null);
  const [themeStudioOpen, setThemeStudioOpen] = useState(false);
  const [themeSearch, setThemeSearch] = useState('');
  const [customThemeTemplates, setCustomThemeTemplates] = useState<ThemeTemplate[]>([]);
  const [themeCatalogGraphId, setThemeCatalogGraphId] = useState(THEME_GRAPH_SOURCE_ID);
  const [themeCatalogLoading, setThemeCatalogLoading] = useState(false);
  const [themeCatalogError, setThemeCatalogError] = useState('');
  const [themeGraphCatalog, setThemeGraphCatalog] = useState<ThemeGraphCatalogItem[]>([]);
  const [themeGraphCatalogLoading, setThemeGraphCatalogLoading] = useState(false);
  const [themeGraphCatalogError, setThemeGraphCatalogError] = useState('');
  const [themeSelectedId, setThemeSelectedId] = useState(BUILT_IN_THEME_TEMPLATES[0].id);
  const [themeSourceUrl, setThemeSourceUrl] = useState('');
  const [themeSourceLabel, setThemeSourceLabel] = useState('');
  const [themeAiMode, setThemeAiMode] = useState<'new' | 'remix'>('new');
  const [themeAiLabel, setThemeAiLabel] = useState('');
  const [themeAiPrompt, setThemeAiPrompt] = useState('');
  const [themeAiGoogleFontUrl, setThemeAiGoogleFontUrl] = useState('');
  const [themeAiCreatePage, setThemeAiCreatePage] = useState(true);
  const [themeAiGraphId, setThemeAiGraphId] = useState(GRAPH_IDENTIFIER);
  const [themeAiHeroImageUrl, setThemeAiHeroImageUrl] = useState('');
  const [themeAiLoading, setThemeAiLoading] = useState(false);
  const [themeAiError, setThemeAiError] = useState('');
  const [themeAiResult, setThemeAiResult] = useState<{ themeId: string; themeLabel: string } | null>(null);
  const [themeAiPageResult, setThemeAiPageResult] = useState<{
    graphId: string;
    htmlNodeId: string;
    label: string;
  } | null>(null);
  const [themeImportGraphId, setThemeImportGraphId] = useState(THEME_GRAPH_SOURCE_ID);
  const [themeImportCssNodeId, setThemeImportCssNodeId] = useState('');
  const [themeImportLabel, setThemeImportLabel] = useState('');
  const [themeCreateLoading, setThemeCreateLoading] = useState(false);
  const [themeCreateError, setThemeCreateError] = useState('');
  const [themeCreateResult, setThemeCreateResult] = useState<{
    themeId: string;
    themeLabel: string;
    hostname: string;
  } | null>(null);
  const [themeTargetGraphId, setThemeTargetGraphId] = useState(GRAPH_IDENTIFIER);
  const [themeTargetHtmlNodeId, setThemeTargetHtmlNodeId] = useState('');
  const [themeCssNodeId, setThemeCssNodeId] = useState('');
  const [themeApplyLoading, setThemeApplyLoading] = useState(false);
  const [themeApplyError, setThemeApplyError] = useState('');
  const [themeApplyResult, setThemeApplyResult] = useState<{
    graphId: string;
    htmlNodeId: string;
    cssNodeId: string;
    themeId: string;
    themeLabel: string;
    appliedHtmlNodeCount?: number;
  } | null>(null);
  const [themeValidationLoading, setThemeValidationLoading] = useState(false);
  const [themeValidationResult, setThemeValidationResult] = useState<{
    valid: boolean;
    missingRequiredClasses: string[];
    missingOptionalClasses: string[];
    presentClasses: string[];
  } | null>(null);
  const [themeFilterScope, setThemeFilterScope] = useState<ThemeFilterScope>('all');
  const [themeSortMode, setThemeSortMode] = useState<ThemeSortMode>('newest');
  const [themeUsageCounts, setThemeUsageCounts] = useState<Record<string, number>>({});
  const [themePreviewModalId, setThemePreviewModalId] = useState<string | null>(null);
  const [themePreviewImageById, setThemePreviewImageById] = useState<Record<string, string>>({});
  const [themePreviewImageLoading, setThemePreviewImageLoading] = useState(false);
  const [themePreviewImageError, setThemePreviewImageError] = useState('');
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [editingThemeLabel, setEditingThemeLabel] = useState('');
  const [editingThemeDescription, setEditingThemeDescription] = useState('');
  const [editingThemeTags, setEditingThemeTags] = useState('');
  const [editingThemeVisibility, setEditingThemeVisibility] = useState<'shared' | 'private'>('shared');
  const [editingThemeSaving, setEditingThemeSaving] = useState(false);
  const [editingThemeError, setEditingThemeError] = useState('');
  const lastInitializedSessionKey = useRef<string | null>(null);
  const sessionInitPromise = useRef<Promise<void> | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const chatSessionIdRef = useRef<string | null>(null);

  const sessionStorageKey = useMemo(() => {
    if (!canPersistHistory || !userId.trim()) return null;
    return `grok-chat-session:${userId.trim()}:${GRAPH_IDENTIFIER}`;
  }, [canPersistHistory, userId]);

  const themeUsageStorageKey = useMemo(() => {
    const owner = userId.trim() || initialEmail?.trim() || 'anon';
    return `${CUSTOM_THEME_STORAGE_KEY_PREFIX}:usage:v1:${owner}`;
  }, [userId, initialEmail]);

  // Note: Theme graph is the only source-of-truth for Theme Studio. We do not auto-overwrite
  // other graph inputs (apply-theme target graph, create-theme-page graph, etc.) because they
  // represent where the user wants to write/apply changes.

  const builtInThemeIds = useMemo(
    () => new Set(BUILT_IN_THEME_TEMPLATES.map((theme) => theme.id)),
    []
  );

  const allThemeTemplates = useMemo(() => {
    const byId = new Map<string, ThemeTemplate>();
    // Custom themes (theme graph) should override built-ins when ids collide,
    // otherwise the UI will show the contract-preview instead of the real theme page.
    [...BUILT_IN_THEME_TEMPLATES, ...customThemeTemplates].forEach((theme) => {
      byId.set(theme.id, theme);
    });
    return [...byId.values()];
  }, [customThemeTemplates]);

  const filteredThemeTemplates = useMemo(() => {
    const trimmedUserId = userId.trim();
    let scopedThemes = allThemeTemplates;
    if (themeFilterScope === 'mine') {
      scopedThemes = allThemeTemplates.filter((theme) => {
        if (builtInThemeIds.has(theme.id)) return false;
        if (!trimmedUserId) return !theme.ownerUserId;
        return theme.ownerUserId ? theme.ownerUserId === trimmedUserId : true;
      });
    } else if (themeFilterScope === 'shared') {
      scopedThemes = allThemeTemplates.filter((theme) => {
        if (builtInThemeIds.has(theme.id)) return true;
        const isOwned = Boolean(trimmedUserId && theme.ownerUserId === trimmedUserId);
        return !isOwned && (theme.visibility || 'shared') === 'shared';
      });
    }

    const needle = normalizeThemeSearch(themeSearch);
    if (!needle) return scopedThemes;
    return scopedThemes.filter((theme) =>
      [theme.id, theme.label, ...theme.tags]
        .map((item) => normalizeThemeSearch(item))
        .some((candidate) => candidate.includes(needle))
    );
  }, [themeSearch, allThemeTemplates, themeFilterScope, userId, builtInThemeIds]);

  const sortedThemeTemplates = useMemo(() => {
    const trimmedUserId = userId.trim();
    const timestampValue = (theme: ThemeTemplate) => {
      const candidate = theme.updatedAt || theme.createdAt || '';
      const ms = candidate ? Date.parse(candidate) : NaN;
      return Number.isFinite(ms) ? ms : 0;
    };

    const baseSorted = [...filteredThemeTemplates];
    if (themeSortMode === 'most-used') {
      baseSorted.sort((a, b) => {
        const usageDelta = (themeUsageCounts[b.id] || 0) - (themeUsageCounts[a.id] || 0);
        if (usageDelta !== 0) return usageDelta;
        return timestampValue(b) - timestampValue(a);
      });
      return baseSorted;
    }

    if (themeSortMode === 'mine-first') {
      baseSorted.sort((a, b) => {
        const aMine = trimmedUserId && a.ownerUserId === trimmedUserId ? 1 : 0;
        const bMine = trimmedUserId && b.ownerUserId === trimmedUserId ? 1 : 0;
        if (aMine !== bMine) return bMine - aMine;
        return timestampValue(b) - timestampValue(a);
      });
      return baseSorted;
    }

    baseSorted.sort((a, b) => timestampValue(b) - timestampValue(a));
    return baseSorted;
  }, [filteredThemeTemplates, themeSortMode, themeUsageCounts, userId]);

  const selectedThemeTemplate = useMemo(
    () =>
      allThemeTemplates.find((theme) => theme.id === themeSelectedId) ||
      BUILT_IN_THEME_TEMPLATES[0],
    [themeSelectedId, allThemeTemplates]
  );

  const previewThemeTemplate = useMemo(
    () => allThemeTemplates.find((theme) => theme.id === themePreviewModalId) || null,
    [allThemeTemplates, themePreviewModalId]
  );

  const themeGraphCatalogOptions = useMemo(() => {
    const currentGraphId = themeCatalogGraphId.trim();
    const options = [...themeGraphCatalog];
    if (currentGraphId && !options.some((item) => item.id === currentGraphId)) {
      options.unshift({
        id: currentGraphId,
        title: currentGraphId,
        updatedAt: '',
        createdBy: ''
      });
    }
    return options;
  }, [themeCatalogGraphId, themeGraphCatalog]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!themeStudioOpen) return;
    loadThemeGraphCatalog().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeStudioOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!themeStudioOpen) return;
    if (!themeCatalogGraphId.trim()) return;
    loadThemesFromGraph().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeStudioOpen, themeCatalogGraphId]);

  useEffect(() => {
    const selectedGraphId = themeCatalogGraphId.trim();
    if (!selectedGraphId) return;
    setThemeAiGraphId(selectedGraphId);
  }, [themeCatalogGraphId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(themeUsageStorageKey);
      if (!raw) {
        setThemeUsageCounts({});
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        setThemeUsageCounts({});
        return;
      }
      const normalized = Object.entries(parsed as Record<string, unknown>).reduce<Record<string, number>>(
        (acc, [themeId, value]) => {
          const count = Number(value);
          if (themeId && Number.isFinite(count) && count > 0) {
            acc[themeId] = Math.floor(count);
          }
          return acc;
        },
        {}
      );
      setThemeUsageCounts(normalized);
    } catch {
      setThemeUsageCounts({});
    }
  }, [themeUsageStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(themeUsageStorageKey, JSON.stringify(themeUsageCounts));
    } catch {
      // Ignore localStorage write errors
    }
  }, [themeUsageCounts, themeUsageStorageKey]);

  useEffect(() => {
    if (!allThemeTemplates.some((theme) => theme.id === themeSelectedId)) {
      setThemeSelectedId(BUILT_IN_THEME_TEMPLATES[0].id);
    }
  }, [allThemeTemplates, themeSelectedId]);

  useEffect(() => {
    if (!providerSupportsImages) {
      setUploadedImage(null);
    }
  }, [providerSupportsImages]);

  useEffect(() => {
    if (initialUserId && initialUserId !== userId) {
      setUserId(initialUserId);
    }
  }, [initialUserId, userId]);

  useEffect(() => {
    if (initialEmail && initialEmail !== userEmail) {
      setUserEmail(initialEmail);
    }
  }, [initialEmail, userEmail]);

  useEffect(() => {
    if (!themePreviewModalId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeThemePreviewModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [themePreviewModalId]);

  const showToast = (message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3000);
  };

  const getRequiredUserId = () => {
    const trimmed = userId.trim();
    if (!trimmed) {
      showToast('Sign in to continue.');
      return null;
    }
    return trimmed;
  };

  const incrementThemeUsage = (themeId: string) => {
    const trimmed = themeId.trim();
    if (!trimmed) return;
    setThemeUsageCounts((prev) => ({
      ...prev,
      [trimmed]: (prev[trimmed] || 0) + 1
    }));
  };

  const closeThemePreviewModal = () => {
    setThemePreviewModalId(null);
    setThemePreviewImageLoading(false);
    setThemePreviewImageError('');
  };

  const openThemePreviewModal = async (theme: ThemeTemplate) => {
    setThemeSelectedId(theme.id);
    setThemePreviewModalId(theme.id);
    setThemePreviewImageError('');

    if (themePreviewImageById[theme.id]) return;

    setThemePreviewImageLoading(true);
    try {
      const query = [theme.label, ...theme.tags.slice(0, 2), 'website ui'].filter(Boolean).join(' ');
      const response = await fetch('https://api.vegvisr.org/unsplash-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, count: 1 })
      });
      if (!response.ok) {
        throw new Error(`Unsplash search failed (${response.status})`);
      }
      const data = await response.json().catch(() => ({}));
      const firstImage = Array.isArray(data?.images) ? data.images[0] : null;
      const imageUrl = String(firstImage?.url || '').trim();
      if (!imageUrl) {
        throw new Error('No preview image found.');
      }

      setThemePreviewImageById((prev) => ({
        ...prev,
        [theme.id]: imageUrl
      }));

      const downloadLocation = String(firstImage?.download_location || '').trim();
      if (downloadLocation) {
        fetch('https://api.vegvisr.org/unsplash-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ download_location: downloadLocation })
        }).catch(() => null);
      }
    } catch (error) {
      setThemePreviewImageError(error instanceof Error ? error.message : 'Unable to load preview image.');
    } finally {
      setThemePreviewImageLoading(false);
    }
  };

  const resolveGraphId = () => {
    const themeGraph = themeTargetGraphId.trim();
    if (themeGraph) return themeGraph;
    const importGraph = htmlImportTargetGraphId.trim();
    return importGraph || GRAPH_IDENTIFIER;
  };

  const authHeaders = () => {
    const headers: Record<string, string> = {};
    const trimmedUser = userId.trim();
    const trimmedEmail = userEmail.trim();
    if (trimmedUser) headers['x-user-id'] = trimmedUser;
    if (trimmedEmail) headers['x-user-email'] = trimmedEmail;
    headers['x-user-role'] = 'Superadmin';
    return headers;
  };

  const postDomainWorkerJson = async (
    endpoint: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    let json: Record<string, unknown> | null = null;
    if (rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = null;
      }
    }

    if (!response.ok || json?.success === false) {
      const detail =
        (typeof json?.message === 'string' && json.message) ||
        rawText ||
        `Request failed (${response.status})`;
      throw new Error(detail);
    }

    return json || {};
  };

  const isCustomThemeEditable = (theme: ThemeTemplate) => {
    if (builtInThemeIds.has(theme.id)) return false;
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) return !theme.ownerUserId;
    return !theme.ownerUserId || theme.ownerUserId === trimmedUserId;
  };

  const beginEditCustomTheme = (theme: ThemeTemplate) => {
    if (!isCustomThemeEditable(theme)) return;
    setEditingThemeId(theme.id);
    setEditingThemeLabel(theme.label || '');
    setEditingThemeDescription(theme.description || '');
    setEditingThemeTags((theme.tags || []).join(', '));
    setEditingThemeVisibility((theme.visibility || 'shared') === 'private' ? 'private' : 'shared');
    setEditingThemeError('');
  };

  const cancelEditCustomTheme = () => {
    setEditingThemeId(null);
    setEditingThemeLabel('');
    setEditingThemeDescription('');
    setEditingThemeTags('');
    setEditingThemeVisibility('shared');
    setEditingThemeError('');
  };

  const handleSaveEditedTheme = async () => {
    if (!editingThemeId) return;
    const existingTheme = customThemeTemplates.find((theme) => theme.id === editingThemeId);
    if (!existingTheme) {
      setEditingThemeError('Theme no longer exists.');
      return;
    }

    const trimmedLabel = editingThemeLabel.trim();
    if (!trimmedLabel) {
      setEditingThemeError('Theme name is required.');
      return;
    }

    setEditingThemeSaving(true);
    setEditingThemeError('');
    try {
      const editedTheme: ThemeTemplate = {
        ...existingTheme,
        label: trimmedLabel,
        description: editingThemeDescription.trim() || existingTheme.description,
        tags: editingThemeTags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        visibility: editingThemeVisibility,
        updatedAt: new Date().toISOString()
      };

      setCustomThemeTemplates((prev) =>
        prev.map((theme) => (theme.id === editedTheme.id ? editedTheme : theme))
      );

      showToast(`Updated theme "${editedTheme.label}".`);
      cancelEditCustomTheme();
    } catch (error) {
      setEditingThemeError(error instanceof Error ? error.message : 'Failed to update theme.');
    } finally {
      setEditingThemeSaving(false);
    }
  };

  const handleDeleteCustomTheme = async (theme: ThemeTemplate) => {
    if (!isCustomThemeEditable(theme)) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Delete theme "${theme.label}"?`);
      if (!confirmed) return;
    }
    setCustomThemeTemplates((prev) => prev.filter((item) => item.id !== theme.id));
    if (themeSelectedId === theme.id) {
      setThemeSelectedId(BUILT_IN_THEME_TEMPLATES[0].id);
    }
    showToast(`Deleted theme "${theme.label}".`);
  };

  const executeLocalGraphCommand = async (prompt: string): Promise<LocalGraphCommandResult> => {
    const text = prompt.trim();
    if (!text) return { handled: false };

    const graphId = resolveGraphId();

    if (/^(?:list|show)\s+(?:theme|themes|template themes|templates)\b/i.test(text)) {
      const summary = allThemeTemplates.map((theme) => `${theme.id} (${theme.label})`).join(', ');
      return {
        handled: true,
        response: `Available theme templates: ${summary}. Example: "Apply theme coastal-blue to html node <htmlNodeId>".`
      };
    }

    if (/theme\s+(?:contract|classes|class set)/i.test(text)) {
      return {
        handled: true,
        response: `Theme contract classes: ${THEME_CONTRACT_CLASSES.join(', ')}. Use these in AI-generated HTML for consistent styling.`
      };
    }

    const createThemeFromUrlCmd =
      text.match(/create\s+(?:a\s+)?theme\s+from\s+url\s+(https?:\/\/[^\s]+)(?:\s+label\s*[:=]\s*["']([^"']+)["'])?/i) ||
      text.match(/generate\s+theme\s+from\s+(https?:\/\/[^\s]+)/i);
    if (createThemeFromUrlCmd) {
      const sourceUrl = createThemeFromUrlCmd[1];
      const customLabel = createThemeFromUrlCmd[2] || '';
      const result = await postDomainWorkerJson(THEME_CREATE_FROM_URL_ENDPOINT, {
        url: sourceUrl,
        label: customLabel || undefined
      });
      const themeRaw = result?.theme as ThemeTemplate | undefined;
      if (!themeRaw || !themeRaw.id || !themeRaw.label) {
        return {
          handled: true,
          response: 'Theme generation completed but returned invalid data.'
        };
      }
      setCustomThemeTemplates((prev) => {
        const next = prev.filter((item) => item.id !== themeRaw.id);
        return [themeRaw, ...next];
      });
      setThemeSelectedId(themeRaw.id);
      setThemeCreateResult({
        themeId: themeRaw.id,
        themeLabel: themeRaw.label,
        hostname: String((result?.source as { hostname?: string } | undefined)?.hostname || '')
      });
      return {
        handled: true,
        response: `Created custom theme "${themeRaw.label}" (${themeRaw.id}) from ${sourceUrl}.`
      };
    }

    const bulkApplyThemeCmd =
      text.match(/(?:apply|use)\s+theme\s+(.+?)\s+(?:to|for)\s+all\s+html(?:[-\s]?nodes?)/i) ||
      text.match(/theme\s+(.+?)\s+all\s+html(?:[-\s]?nodes?)/i);
    if (bulkApplyThemeCmd) {
      const themeNeedle = bulkApplyThemeCmd[1].trim().replace(/^["'`]|["'`]$/g, '');
      const cssMatch = text.match(/(?:using|with)\s+css(?:\s+node)?\s*([a-zA-Z0-9_-]+)/i);
      const cssNodeId = cssMatch ? cssMatch[1] : '';
      const theme = resolveThemeTemplateInCatalog(themeNeedle, allThemeTemplates);
      if (!theme) {
        const available = allThemeTemplates.map((item) => item.id).join(', ');
        return {
          handled: true,
          response: `Unknown theme "${themeNeedle}". Available themes: ${available}.`
        };
      }
      const isBuiltInTheme = BUILT_IN_THEME_TEMPLATES.some((item) => item.id === theme.id);
      const result = await postDomainWorkerJson(GRAPH_APPLY_THEME_TEMPLATE_BULK_ENDPOINT, {
        graphId,
        themeId: theme.id,
        customTheme: isBuiltInTheme ? undefined : theme,
        cssNodeId: cssNodeId || undefined,
        replaceExisting: true,
        userRole: 'Superadmin',
        userEmail: userEmail.trim() || undefined,
        appliedBy: userEmail.trim() || userId.trim() || 'aichat-vegvisr'
      });
      const htmlNodeCount = Number(result?.htmlNodeCount || 0);
      const savedCssNodeId = String(result?.cssNodeId || cssNodeId || '').trim();
      setThemeSelectedId(theme.id);
      setThemeTargetGraphId(graphId);
      setThemeCssNodeId(savedCssNodeId);
      setThemeApplyResult({
        graphId,
        htmlNodeId: 'all-html-nodes',
        cssNodeId: savedCssNodeId,
        themeId: theme.id,
        themeLabel: theme.label,
        appliedHtmlNodeCount: htmlNodeCount
      });
      incrementThemeUsage(theme.id);
      return {
        handled: true,
        response: `Applied theme "${theme.label}" to ${htmlNodeCount} html-node(s) in graph \`${graphId}\` using css-node \`${savedCssNodeId || 'unknown'}\`.`
      };
    }

    const validateThemeCmd =
      text.match(/validate\s+(?:theme\s+)?contract\s+(?:for\s+)?html(?:\s+node)?\s*([a-zA-Z0-9_-]+)/i) ||
      text.match(/check\s+theme\s+contract\s+(?:for\s+)?html(?:\s+node)?\s*([a-zA-Z0-9_-]+)/i);
    if (validateThemeCmd) {
      const htmlNodeId = validateThemeCmd[1];
      const result = await postDomainWorkerJson(GRAPH_VALIDATE_THEME_CONTRACT_ENDPOINT, {
        graphId,
        htmlNodeId
      });
      const coverage = (result?.coverage as {
        valid?: boolean;
        presentClasses?: string[];
        missingRequiredClasses?: string[];
        missingOptionalClasses?: string[];
      }) || { valid: false, presentClasses: [], missingRequiredClasses: [], missingOptionalClasses: [] };

      setThemeTargetGraphId(graphId);
      setThemeTargetHtmlNodeId(htmlNodeId);
      setThemeValidationResult({
        valid: Boolean(coverage.valid),
        presentClasses: Array.isArray(coverage.presentClasses) ? coverage.presentClasses : [],
        missingRequiredClasses: Array.isArray(coverage.missingRequiredClasses) ? coverage.missingRequiredClasses : [],
        missingOptionalClasses: Array.isArray(coverage.missingOptionalClasses) ? coverage.missingOptionalClasses : []
      });

      return {
        handled: true,
        response: coverage.valid
          ? `Theme contract valid for html-node \`${htmlNodeId}\`. Missing optional classes: ${(coverage.missingOptionalClasses || []).join(', ') || 'none'}.`
          : `Theme contract missing required classes for html-node \`${htmlNodeId}\`: ${(coverage.missingRequiredClasses || []).join(', ')}.`
      };
    }

    const applyThemeCmd =
      text.match(/(?:apply|use)\s+theme\s+(.+?)\s+(?:to|for)\s+html(?:\s+node)?\s*([a-zA-Z0-9_-]+)(?:\s|$)/i) ||
      text.match(/theme\s+(.+?)\s+html(?:\s+node)?\s*([a-zA-Z0-9_-]+)(?:\s|$)/i);
    if (applyThemeCmd) {
      const themeNeedle = applyThemeCmd[1].trim().replace(/^["'`]|["'`]$/g, '');
      const htmlNodeId = applyThemeCmd[2];
      const cssMatch = text.match(/(?:using|with)\s+css(?:\s+node)?\s*([a-zA-Z0-9_-]+)/i);
      const cssNodeId = cssMatch ? cssMatch[1] : '';
      const theme = resolveThemeTemplateInCatalog(themeNeedle, allThemeTemplates);
      if (!theme) {
        const available = allThemeTemplates.map((item) => item.id).join(', ');
        return {
          handled: true,
          response: `Unknown theme "${themeNeedle}". Available themes: ${available}.`
        };
      }
      const isBuiltInTheme = BUILT_IN_THEME_TEMPLATES.some((item) => item.id === theme.id);

      const result = await postDomainWorkerJson(GRAPH_APPLY_THEME_TEMPLATE_ENDPOINT, {
        graphId,
        htmlNodeId,
        themeId: theme.id,
        customTheme: isBuiltInTheme ? undefined : theme,
        cssNodeId: cssNodeId || undefined,
        replaceExisting: true,
        userRole: 'Superadmin',
        userEmail: userEmail.trim() || undefined,
        appliedBy: userEmail.trim() || userId.trim() || 'aichat-vegvisr'
      });

      const savedCssNodeId = String(result?.cssNodeId || cssNodeId || '').trim();
      const coverage = (result?.themeContractCoverage as {
        valid?: boolean;
        presentClasses?: string[];
        missingRequiredClasses?: string[];
        missingOptionalClasses?: string[];
      }) || null;
      setThemeSelectedId(theme.id);
      setThemeTargetGraphId(graphId);
      setThemeTargetHtmlNodeId(htmlNodeId);
      setThemeCssNodeId(savedCssNodeId);
      setThemeApplyResult({
        graphId,
        htmlNodeId,
        cssNodeId: savedCssNodeId,
        themeId: theme.id,
        themeLabel: theme.label
      });
      incrementThemeUsage(theme.id);
      if (coverage) {
        setThemeValidationResult({
          valid: Boolean(coverage.valid),
          presentClasses: Array.isArray(coverage.presentClasses) ? coverage.presentClasses : [],
          missingRequiredClasses: Array.isArray(coverage.missingRequiredClasses) ? coverage.missingRequiredClasses : [],
          missingOptionalClasses: Array.isArray(coverage.missingOptionalClasses) ? coverage.missingOptionalClasses : []
        });
      }

      return {
        handled: true,
        response: `Applied theme "${theme.label}" to html-node \`${htmlNodeId}\` in graph \`${graphId}\` using css-node \`${savedCssNodeId || 'unknown'}\`.`
      };
    }

    const createCmd =
      text.match(
        /(?:create|clone|duplicate)\s+(?:a\s+)?(?:new\s+)?html(?:[-\s]?node)?[\s\S]*?(?:from|based on|using)\s+node(?:id)?\s*[:=]?\s*([a-zA-Z0-9_-]+)/i
      ) ||
      text.match(/(?:new|clone)\s+html(?:[-\s]?node)?\s+from\s+([a-zA-Z0-9_-]+)/i);
    if (createCmd) {
      const sourceNodeId = createCmd[1];
      const cssMatch = text.match(/(?:with|and|use)\s+css(?:\s+from)?\s+(?:node(?:id)?\s*)?([a-zA-Z0-9_-]+)/i);
      const cssNodeId = cssMatch ? cssMatch[1] : '';
      const labelMatch = text.match(/label\s*[:=]\s*["']([^"']+)["']/i);
      const requestedLabel = labelMatch ? labelMatch[1].trim() : '';

      const result = await postDomainWorkerJson(GRAPH_CLONE_HTML_NODE_ENDPOINT, {
        graphId,
        sourceHtmlNodeId: sourceNodeId,
        cssNodeId: cssNodeId || undefined,
        label: requestedLabel || undefined,
        userRole: 'Superadmin',
        userEmail: userEmail.trim() || undefined,
        clonedBy: userEmail.trim() || userId.trim() || 'aichat-vegvisr'
      });
      const newHtmlNodeId = String(result?.newHtmlNodeId || '').trim();

      return {
        handled: true,
        response: `Created html-node \`${newHtmlNodeId || 'unknown'}\` in graph \`${graphId}\`${cssNodeId ? ` and attached css-node \`${cssNodeId}\`.` : '.'}`
      };
    }

    const attachCmd =
      text.match(/attach\s+css(?:\s+node)?\s*([a-zA-Z0-9_-]+)\s+to\s+html(?:\s+node)?\s*([a-zA-Z0-9_-]+)/i) ||
      text.match(/use\s+css\s+node\s*([a-zA-Z0-9_-]+)\s+for\s+html\s+node\s*([a-zA-Z0-9_-]+)/i) ||
      text.match(/apply\s+css(?:\s+node)?\s*([a-zA-Z0-9_-]+)\s+to\s+html(?:\s+node)?\s*([a-zA-Z0-9_-]+)/i);
    if (attachCmd) {
      const cssNodeId = attachCmd[1];
      const htmlNodeId = attachCmd[2];
      await postDomainWorkerJson(GRAPH_ATTACH_STYLES_ENDPOINT, {
        graphId,
        cssNodeId,
        htmlNodeId,
        replaceExisting: true,
        userRole: 'Superadmin'
      });

      return {
        handled: true,
        response: `Attached css-node \`${cssNodeId}\` to html-node \`${htmlNodeId}\` in graph \`${graphId}\`.`
      };
    }

    const detachCmd =
      text.match(/detach\s+css(?:\s+node)?\s*([a-zA-Z0-9_-]+)?\s*from\s+html(?:\s+node)?\s*([a-zA-Z0-9_-]+)/i) ||
      text.match(/remove\s+styles?\s+from\s+html(?:\s+node)?\s*([a-zA-Z0-9_-]+)/i);
    if (detachCmd) {
      const cssNodeId = detachCmd[2] ? (detachCmd[1] || '').trim() : '';
      const htmlNodeId = detachCmd[2] ? detachCmd[2] : detachCmd[1];
      const result = await postDomainWorkerJson(GRAPH_DETACH_STYLES_ENDPOINT, {
        graphId,
        cssNodeId: cssNodeId || undefined,
        htmlNodeId,
        userRole: 'Superadmin'
      });
      const removed = Number(result?.removedStylesEdges || 0);
      return {
        handled: true,
        response: `Detached ${removed} styles edge(s) for html-node \`${htmlNodeId}\` in graph \`${graphId}\`.`
      };
    }

    return { handled: false };
  };

  const resetHtmlImportState = () => {
    setHtmlImportError('');
    setHtmlImportGraphId(null);
    setHtmlImportStats(null);
  };

  const resetThemeStudioState = () => {
    setThemeApplyError('');
    setThemeApplyResult(null);
    setThemeValidationResult(null);
    setThemeCreateError('');
    setThemeCreateResult(null);
    setThemeAiError('');
    setThemeAiResult(null);
    setThemeAiPageResult(null);
    setThemeCatalogError('');
  };

  const loadThemeGraphCatalog = async () => {
    setThemeGraphCatalogError('');
    setThemeGraphCatalogLoading(true);
    try {
      const response = await fetch(GRAPH_THEME_CATALOG_ENDPOINT, {
        method: 'GET',
        headers: { ...authHeaders() }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false || !Array.isArray(data?.results)) {
        throw new Error(String(data?.message || `Theme graph catalog failed (${response.status}).`));
      }

      const options: ThemeGraphCatalogItem[] = (data.results as Array<Record<string, unknown>>)
        .map((item) => ({
          id: String(item?.id || '').trim(),
          title: String(item?.title || 'Untitled Theme Graph').trim(),
          updatedAt: String(item?.updatedAt || ''),
          createdBy: String(item?.createdBy || '')
        }))
        .filter((item) => item.id);

      setThemeGraphCatalog(options);
      if (!themeCatalogGraphId.trim() && options.length > 0) {
        setThemeCatalogGraphId(options[0].id);
      }
    } catch (error) {
      setThemeGraphCatalogError(
        error instanceof Error ? error.message : 'Unable to load Theme Graph catalog.'
      );
      setThemeGraphCatalog([]);
    } finally {
      setThemeGraphCatalogLoading(false);
    }
  };

  const loadThemesFromGraph = async (graphIdOverride?: string) => {
    setThemeCatalogError('');
    setThemeCatalogLoading(true);
    try {
      const graphId = (graphIdOverride || themeCatalogGraphId).trim();
      if (!graphId) throw new Error('Graph ID is required.');

      const url = new URL(GRAPH_GET_ENDPOINT, window.location.origin);
      url.searchParams.set('id', graphId);
      const response = await fetch(url.toString(), { method: 'GET', headers: { ...authHeaders() } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data || !Array.isArray(data?.nodes)) {
        throw new Error(String(data?.message || `Graph load failed (${response.status}).`));
      }

      const graphData: GraphData = { nodes: data.nodes as GraphNode[], edges: data.edges as GraphEdge[] };
      const nodes: GraphNode[] = graphData.nodes;
      const themes: ThemeTemplate[] = nodes
        .filter((node) => String(node?.type || '').toLowerCase() === 'html-node')
        .map((node) => buildThemeFromHtmlNode(node, graphId, graphData))
        .filter((theme): theme is ThemeTemplate => Boolean(theme && theme.id && theme.tokens));

      setCustomThemeTemplates(themes.slice(0, 300));
    } catch (error) {
      setThemeCatalogError(error instanceof Error ? error.message : 'Unable to load themes.');
    } finally {
      setThemeCatalogLoading(false);
    }
  };

  const buildThemePrompt = (theme: ThemeTemplate) =>
    `Create standalone semantic HTML using Vegvisr theme contract v1. Use only these classes: ${THEME_CONTRACT_CLASSES.join(
      ', '
    )}. Keep custom CSS minimal and rely on the theme CSS node. Use data-v-theme="${theme.id}" on the html element.`;

  const handleCopyThemePrompt = async () => {
    try {
      const prompt = buildThemePrompt(selectedThemeTemplate);
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard API not available');
      }
      await navigator.clipboard.writeText(prompt);
      showToast('Theme prompt copied.');
    } catch {
      showToast('Unable to copy prompt on this browser.');
    }
  };

  const handleCreateThemeFromUrl = async () => {
    const urlValue = themeSourceUrl.trim();
    const labelValue = themeSourceLabel.trim();
    resetThemeStudioState();

    if (!urlValue) {
      setThemeCreateError('Please enter a source URL.');
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlValue);
    } catch {
      setThemeCreateError('Please enter a valid URL.');
      return;
    }
    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      setThemeCreateError('Only http(s) URLs are supported.');
      return;
    }

    setThemeCreateLoading(true);
    try {
      const result = await postDomainWorkerJson(THEME_CREATE_FROM_URL_ENDPOINT, {
        url: parsedUrl.toString(),
        label: labelValue || undefined
      });
      const themeRaw = result?.theme as ThemeTemplate | undefined;
      if (!themeRaw || !themeRaw.id || !themeRaw.label || !themeRaw.tokens) {
        throw new Error('Theme generation succeeded but returned invalid theme data.');
      }

      setCustomThemeTemplates((prev) => {
        const next = prev.filter((item) => item.id !== themeRaw.id);
        return [themeRaw, ...next];
      });
      setThemeSelectedId(themeRaw.id);
      setThemeCreateResult({
        themeId: themeRaw.id,
        themeLabel: themeRaw.label,
        hostname: String((result?.source as { hostname?: string } | undefined)?.hostname || '')
      });
      showToast(`Created theme "${themeRaw.label}".`);
    } catch (error) {
      setThemeCreateError(error instanceof Error ? error.message : 'Theme creation failed.');
    } finally {
      setThemeCreateLoading(false);
    }
  };

  const handleGenerateThemeWithAi = async () => {
    const requiredUserId = getRequiredUserId();
    if (!requiredUserId) return;

    const labelValue = themeAiLabel.trim();
    const promptValue = themeAiPrompt.trim();
    const fontUrlValue = themeAiGoogleFontUrl.trim();

    resetThemeStudioState();
    if (!promptValue) {
      setThemeAiError('Please describe the theme you want.');
      return;
    }

      setThemeAiLoading(true);
      try {
      const system = `You generate Vegvisr Theme Studio theme templates.\n\nReturn JSON only (no markdown, no code fences).\nSchema:\n{\n  \"id\": \"kebab-case\",\n  \"label\": \"Human name\",\n  \"description\": \"1 short sentence\",\n  \"tags\": [\"tag\"],\n  \"googleFontImportUrl\": \"https://fonts.googleapis.com/...\",\n  \"fontFamily\": \"'Font Name', -apple-system, 'Segoe UI', sans-serif\",\n  \"palette\": [\n    { \"name\": \"Color name\", \"hex\": \"#RRGGBB\" }\n  ],\n  \"tokens\": {\n    \"bg\": \"#RRGGBB\",\n    \"surface\": \"#RRGGBB\",\n    \"surfaceElevated\": \"#RRGGBB\",\n    \"text\": \"#RRGGBB\",\n    \"muted\": \"#RRGGBB\",\n    \"primary\": \"#RRGGBB\",\n    \"primaryInk\": \"#RRGGBB\",\n    \"border\": \"#RRGGBB\",\n    \"radius\": \"16px\",\n    \"shadow\": \"0 20px 45px rgba(0,0,0,0.12)\"\n  }\n}\nRules:\n- Ensure readable contrast: text must be readable on bg and surface.\n- primaryInk must be readable on primary.\n- tags: 3-6 short tags.\n- radius: px value between 12px and 24px.\n- Provide cohesive palette, modern web UI.\n- Extra keys are allowed but will be ignored.\n`;

      const remixContext =
        themeAiMode === 'remix'
          ? `\nRemix this existing theme (keep it recognizable but distinct):\n${JSON.stringify(
              {
                id: selectedThemeTemplate.id,
                label: selectedThemeTemplate.label,
                tags: selectedThemeTemplate.tags,
                tokens: selectedThemeTemplate.tokens,
                googleFontImportUrl: selectedThemeTemplate.googleFontImportUrl,
                fontFamily: selectedThemeTemplate.fontFamily
              },
              null,
              2
            )}\n`
          : '';

      const userMessage = `Create a new theme.\nPreferred label (optional): ${labelValue || '(choose)'}\nGoogle font import URL (optional): ${
        fontUrlValue || '(choose)'
      }\nTheme description:\n${promptValue}\n${remixContext}`;

      const payload = {
        userId: requiredUserId,
        model: 'gpt-5.2',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMessage }
        ],
        context: { useGraphContext: false, useSelectionContext: false },
        tools: { useProffTools: false, useSourcesTools: false, useTemplateTools: false },
        attachments: { imageName: null, audioName: null },
        stream: false
      };

      const response = await fetch(CHAT_ENDPOINTS.openai, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`OpenAI worker failed (${response.status}).`);
      }
      const data = await response.json().catch(() => ({}));
      const rawContent =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        data?.message ||
        '';

      const parsed = extractJsonObjectFromText(String(rawContent || ''));
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('AI returned invalid JSON. Try again with a shorter prompt.');
      }

      const candidate = parsed as Partial<ThemeTemplate> & {
        tokens?: Partial<ThemeTemplate['tokens']>;
        palette?: Array<{ name?: string; hex?: string }>;
      };
      const finalId = normalizeThemeId(String(candidate.id || labelValue || '')) || `ai-theme-${Date.now()}`;
      const finalLabel = String(candidate.label || labelValue || 'AI Theme').trim() || 'AI Theme';
      const tags = Array.isArray(candidate.tags)
        ? candidate.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 8)
        : ['ai', 'custom', 'theme'];

      const tokens = (candidate.tokens || {}) as Partial<ThemeTemplate['tokens']>;
      const bg = String(tokens.bg || '#0b1220').trim();
      const surface = String(tokens.surface || '#0f172a').trim();
      const surfaceElevated = String(tokens.surfaceElevated || '#111c33').trim();
      const text = String(tokens.text || '#f8fafc').trim();
      const muted = String(tokens.muted || '#94a3b8').trim();
      const primary = String(tokens.primary || '#22d3ee').trim();
      const primaryInk = String(tokens.primaryInk || '#0f172a').trim();
      const border = String(tokens.border || '#334155').trim();
      const radius = String(tokens.radius || '16px').trim();
      const shadow = String(tokens.shadow || '0 22px 50px rgba(15, 23, 42, 0.4)').trim();

      let googleFontImportUrl = String(candidate.googleFontImportUrl || '').trim();
      let fontFamily = String(candidate.fontFamily || '').trim();
      if (fontUrlValue) {
        googleFontImportUrl = fontUrlValue;
        if (!fontFamily) {
          const family = fontUrlValue.match(/family=([^:&]+)/)?.[1]?.replace(/\\+/g, ' ') || 'Inter';
          fontFamily = `'${family}', -apple-system, 'Segoe UI', sans-serif`;
        }
      }
      if (!googleFontImportUrl) {
        googleFontImportUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap';
      }
      if (!fontFamily) {
        fontFamily = "'Inter', -apple-system, 'Segoe UI', sans-serif";
      }

      const theme: ThemeTemplate = {
        id: finalId,
        label: finalLabel,
        description: String(candidate.description || 'AI-generated theme template.').trim(),
        tags,
        swatches: [bg, surface, text, muted, primary],
        fontFamily,
        googleFontImportUrl,
        palette: Array.isArray(candidate.palette)
          ? candidate.palette
              .map((item) => ({
                name: String(item?.name || '').trim() || 'Color',
                hex: String(item?.hex || '').trim()
              }))
              .filter((item) => item.hex)
              .slice(0, 10)
          : undefined,
        tokens: {
          bg,
          surface,
          surfaceElevated,
          text,
          muted,
          primary,
          primaryInk,
          border,
          radius,
          shadow
        },
        ownerUserId: requiredUserId,
        ownerEmail: userEmail.trim() || null,
        visibility: (candidate.visibility === 'private' ? 'private' : 'shared') as 'shared' | 'private',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      setCustomThemeTemplates((prev) => {
        const next = prev.filter((item) => item.id !== theme.id);
        return [theme, ...next].slice(0, 100);
      });
      setThemeSelectedId(theme.id);
      setThemeAiResult({ themeId: theme.id, themeLabel: theme.label });
      showToast(`Created theme \"${theme.label}\".`);

      let resolvedHeroImageUrl = themeAiHeroImageUrl.trim();
      if (!resolvedHeroImageUrl) {
        try {
          const query = [theme.label, ...theme.tags.slice(0, 2), 'website ui'].filter(Boolean).join(' ');
          const response = await fetch('https://api.vegvisr.org/unsplash-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, count: 1 })
          });
          if (response.ok) {
            const data = await response.json().catch(() => ({}));
            const firstImage = Array.isArray(data?.images) ? data.images[0] : null;
            const imageUrl = String(firstImage?.url || '').trim();
            if (imageUrl) {
              resolvedHeroImageUrl = imageUrl;
              setThemePreviewImageById((prev) => ({ ...prev, [theme.id]: imageUrl }));
              const downloadLocation = String(firstImage?.download_location || '').trim();
              if (downloadLocation) {
                fetch('https://api.vegvisr.org/unsplash-download', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ download_location: downloadLocation })
                }).catch(() => null);
              }
            }
          }
        } catch {
          // ignore preview image errors
        }
      }

      if (themeAiCreatePage) {
        const graphId = themeAiGraphId.trim() || resolveGraphId();
        try {
          const result = await postDomainWorkerJson(GRAPH_CREATE_THEME_PAGE_NODE_ENDPOINT, {
            graphId,
            theme,
            label: theme.label,
            heroImageUrl: resolvedHeroImageUrl || undefined,
            promptText: promptValue,
            userRole: 'Superadmin',
            userEmail: userEmail.trim() || undefined,
            createdBy: userEmail.trim() || userId.trim() || 'aichat-vegvisr'
          });
          const htmlNodeId = String(result?.newHtmlNodeId || '').trim();
          if (htmlNodeId) {
            // Fetch the actual theme page HTML so the preview matches the graph themes.
            try {
              const url = new URL(GRAPH_GET_ENDPOINT, window.location.origin);
              url.searchParams.set('id', graphId);
              const graphRes = await fetch(url.toString(), { method: 'GET', headers: { ...authHeaders() } });
              const graph = await graphRes.json().catch(() => ({}));
              if (graphRes.ok && Array.isArray(graph?.nodes)) {
                const node = (graph.nodes as GraphNode[]).find((n) => String(n?.id || '') === htmlNodeId);
                const html = node?.info ? String(node.info) : '';
                if (html) {
                  theme.sourceHtml = html;
                  theme.sourceGraphId = graphId;
                  theme.sourceHtmlNodeId = htmlNodeId;
                  setCustomThemeTemplates((prev) => {
                    const next = prev.filter((item) => item.id !== theme.id);
                    return [{ ...theme }, ...next].slice(0, 100);
                  });
                }
              }
            } catch {
              // Ignore: theme is still usable even if we can't fetch the created node right away.
            }

            setThemeAiPageResult({ graphId, htmlNodeId, label: theme.label });
            showToast(`Created theme page node \"${theme.label}\".`);
            if (themeCatalogGraphId.trim() === graphId) {
              loadThemesFromGraph().catch(() => null);
            }
          }
        } catch (error) {
          setThemeAiError(
            error instanceof Error
              ? error.message
              : 'Theme was created, but theme page node creation failed.'
          );
        }
      }

      openThemePreviewModal(theme).catch(() => null);
    } catch (error) {
      setThemeAiError(error instanceof Error ? error.message : 'AI theme generation failed.');
    } finally {
      setThemeAiLoading(false);
    }
  };

  const handleImportThemeFromGraph = async () => {
    const graphId = themeImportGraphId.trim() || resolveGraphId();
    const preferredCssNodeId = themeImportCssNodeId.trim();
    const label = themeImportLabel.trim();

    resetThemeStudioState();
    if (!graphId) {
      setThemeCreateError('Graph ID is required.');
      return;
    }

    setThemeCreateLoading(true);
    try {
      const response = await fetch(`${GRAPH_GET_ENDPOINT}?id=${encodeURIComponent(graphId)}`, {
        method: 'GET'
      });
      const graph = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`Failed to load graph (${response.status}).`);
      }

      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
      if (!nodes.length) {
        throw new Error('Graph has no nodes.');
      }

      const cssCandidates = nodes.filter((node: any) => {
        const type = String(node?.type || '').toLowerCase();
        return type.includes('css') || type === 'css-node';
      });

      let cssNode = null as any;
      if (preferredCssNodeId) {
        cssNode = cssCandidates.find((node: any) => String(node?.id || '') === preferredCssNodeId) || null;
        if (!cssNode) {
          throw new Error(`CSS node "${preferredCssNodeId}" was not found in this graph.`);
        }
      } else {
        cssNode = cssCandidates[0] || null;
      }

      if (!cssNode) {
        throw new Error('No CSS node found in the graph. Add a CSS node first, then import theme.');
      }

      const cssText = String(cssNode?.info || '').trim();
      if (!cssText) {
        throw new Error('Selected CSS node has empty CSS content.');
      }

      const generatedTheme = extractThemeFromCss({
        cssText,
        baseId: `${graphId}-${cssNode.id || 'css'}`,
        label: label || cssNode.label || `Graph ${graphId} Theme`
      });

      setCustomThemeTemplates((prev) => {
        const next = prev.filter((item) => item.id !== generatedTheme.id);
        return [generatedTheme, ...next];
      });
      setThemeSelectedId(generatedTheme.id);
      setThemeCreateResult({
        themeId: generatedTheme.id,
        themeLabel: generatedTheme.label,
        hostname: graphId
      });
      showToast(`Imported theme "${generatedTheme.label}" from graph ${graphId}.`);
    } catch (error) {
      setThemeCreateError(error instanceof Error ? error.message : 'Theme import from graph failed.');
    } finally {
      setThemeCreateLoading(false);
    }
  };

  const handleApplyThemeTemplate = async () => {
    const graphId = resolveGraphId();
    const htmlNodeId = themeTargetHtmlNodeId.trim();
    const cssNodeId = themeCssNodeId.trim();
    const theme = allThemeTemplates.find((item) => item.id === themeSelectedId);

    resetThemeStudioState();

    if (!graphId) {
      setThemeApplyError('Graph ID is required.');
      return;
    }
    if (!htmlNodeId) {
      setThemeApplyError('HTML node ID is required.');
      return;
    }
    if (!theme) {
      setThemeApplyError('Please select a theme template.');
      return;
    }

    setThemeApplyLoading(true);
    try {
      const isBuiltInTheme = BUILT_IN_THEME_TEMPLATES.some((item) => item.id === theme.id);
      const result = await postDomainWorkerJson(GRAPH_APPLY_THEME_TEMPLATE_ENDPOINT, {
        graphId,
        htmlNodeId,
        themeId: theme.id,
        customTheme: isBuiltInTheme ? undefined : theme,
        cssNodeId: cssNodeId || undefined,
        replaceExisting: true,
        userRole: 'Superadmin',
        userEmail: userEmail.trim() || undefined,
        appliedBy: userEmail.trim() || userId.trim() || 'aichat-vegvisr'
      });

      const savedCssNodeId = String(result?.cssNodeId || cssNodeId || '').trim();
      const coverage = (result?.themeContractCoverage as {
        valid?: boolean;
        presentClasses?: string[];
        missingRequiredClasses?: string[];
        missingOptionalClasses?: string[];
      }) || null;
      setThemeCssNodeId(savedCssNodeId);
      setThemeApplyResult({
        graphId,
        htmlNodeId,
        cssNodeId: savedCssNodeId,
        themeId: theme.id,
        themeLabel: theme.label
      });
      incrementThemeUsage(theme.id);
      if (coverage) {
        setThemeValidationResult({
          valid: Boolean(coverage.valid),
          presentClasses: Array.isArray(coverage.presentClasses) ? coverage.presentClasses : [],
          missingRequiredClasses: Array.isArray(coverage.missingRequiredClasses) ? coverage.missingRequiredClasses : [],
          missingOptionalClasses: Array.isArray(coverage.missingOptionalClasses) ? coverage.missingOptionalClasses : []
        });
      }
      showToast(`Applied ${theme.label} theme.`);
    } catch (error) {
      setThemeApplyError(error instanceof Error ? error.message : 'Theme apply failed.');
    } finally {
      setThemeApplyLoading(false);
    }
  };

  const handleApplyThemeTemplateToAllNodes = async () => {
    const graphId = resolveGraphId();
    const cssNodeId = themeCssNodeId.trim();
    const theme = allThemeTemplates.find((item) => item.id === themeSelectedId);
    resetThemeStudioState();

    if (!graphId) {
      setThemeApplyError('Graph ID is required.');
      return;
    }
    if (!theme) {
      setThemeApplyError('Please select a theme template.');
      return;
    }

    setThemeApplyLoading(true);
    try {
      const isBuiltInTheme = BUILT_IN_THEME_TEMPLATES.some((item) => item.id === theme.id);
      const result = await postDomainWorkerJson(GRAPH_APPLY_THEME_TEMPLATE_BULK_ENDPOINT, {
        graphId,
        themeId: theme.id,
        customTheme: isBuiltInTheme ? undefined : theme,
        cssNodeId: cssNodeId || undefined,
        replaceExisting: true,
        userRole: 'Superadmin',
        userEmail: userEmail.trim() || undefined,
        appliedBy: userEmail.trim() || userId.trim() || 'aichat-vegvisr'
      });
      const savedCssNodeId = String(result?.cssNodeId || cssNodeId || '').trim();
      const htmlNodeCount = Number(result?.htmlNodeCount || 0);
      setThemeCssNodeId(savedCssNodeId);
      setThemeApplyResult({
        graphId,
        htmlNodeId: 'all-html-nodes',
        cssNodeId: savedCssNodeId,
        themeId: theme.id,
        themeLabel: theme.label,
        appliedHtmlNodeCount: htmlNodeCount
      });
      incrementThemeUsage(theme.id);
      showToast(`Applied theme to ${htmlNodeCount} html node(s).`);
    } catch (error) {
      setThemeApplyError(error instanceof Error ? error.message : 'Bulk theme apply failed.');
    } finally {
      setThemeApplyLoading(false);
    }
  };

  const handleValidateThemeContract = async () => {
    const graphId = resolveGraphId();
    const htmlNodeId = themeTargetHtmlNodeId.trim();
    resetThemeStudioState();

    if (!graphId) {
      setThemeApplyError('Graph ID is required.');
      return;
    }
    if (!htmlNodeId) {
      setThemeApplyError('HTML node ID is required.');
      return;
    }

    setThemeValidationLoading(true);
    try {
      const result = await postDomainWorkerJson(GRAPH_VALIDATE_THEME_CONTRACT_ENDPOINT, {
        graphId,
        htmlNodeId
      });
      const coverage = (result?.coverage as {
        valid?: boolean;
        presentClasses?: string[];
        missingRequiredClasses?: string[];
        missingOptionalClasses?: string[];
      }) || { valid: false, presentClasses: [], missingRequiredClasses: [], missingOptionalClasses: [] };

      setThemeValidationResult({
        valid: Boolean(coverage.valid),
        presentClasses: Array.isArray(coverage.presentClasses) ? coverage.presentClasses : [],
        missingRequiredClasses: Array.isArray(coverage.missingRequiredClasses) ? coverage.missingRequiredClasses : [],
        missingOptionalClasses: Array.isArray(coverage.missingOptionalClasses) ? coverage.missingOptionalClasses : []
      });
      showToast(coverage.valid ? 'Theme contract valid.' : 'Theme contract has missing required classes.');
    } catch (error) {
      setThemeApplyError(error instanceof Error ? error.message : 'Theme contract validation failed.');
    } finally {
      setThemeValidationLoading(false);
    }
  };

  const handleImportHtmlTemplate = async () => {
    const url = htmlImportUrl.trim();
    const title = htmlImportTitle.trim();
    const description = htmlImportDescription.trim();
    const targetGraphId = htmlImportTargetGraphId.trim();

    resetHtmlImportState();

    if (!url) {
      setHtmlImportError('Please enter a URL to import.');
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      setHtmlImportError('Please enter a valid URL.');
      return;
    }

    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      setHtmlImportError('Only http(s) URLs are supported.');
      return;
    }

    if (htmlImportMode === 'current' && !targetGraphId) {
      setHtmlImportError('Current graph ID is required for import into current graph.');
      return;
    }

    setHtmlImportLoading(true);
    try {
      const result = await postDomainWorkerJson(HTML_IMPORT_ENDPOINT, {
        url: parsedUrl.toString(),
        title: title || undefined,
        description: description || undefined,
        targetGraphId: htmlImportMode === 'current' ? targetGraphId : undefined,
        createdBy: userEmail.trim() || userId.trim() || 'aichat-vegvisr',
        category: '#HTMLTemplate',
        metaArea: '#Imported',
        publicationState: 'draft'
      });

      const graphIdValue = result?.graphId ?? result?.id;
      const graphId = typeof graphIdValue === 'string' ? graphIdValue.trim() : String(graphIdValue || '').trim();
      if (!graphId) {
        throw new Error('Import succeeded but no graphId was returned.');
      }

      setHtmlImportGraphId(graphId);
      if (htmlImportMode === 'new') {
        setThemeTargetGraphId(graphId);
        setThemeImportGraphId(graphId);
      } else if (htmlImportMode === 'current' && targetGraphId) {
        setThemeTargetGraphId(targetGraphId);
        setThemeImportGraphId(targetGraphId);
      }
      const stats =
        result?.stats && typeof result.stats === 'object'
          ? (result.stats as { cssBytes?: number; htmlBytes?: number; payloadBytes?: number })
          : null;
      setHtmlImportStats(stats);
      showToast('HTML template imported successfully.');
    } catch (error) {
      setHtmlImportError(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setHtmlImportLoading(false);
    }
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  };

  const authorizedHistoryFetch = async (path: string, options: RequestInit = {}) => {
    if (!canPersistHistory) {
      throw new Error('Chat history unavailable for anonymous users');
    }
    const headers = new Headers(options.headers || {});
    const trimmedUser = userId.trim();
    if (!trimmedUser) {
      throw new Error('User id is required');
    }
    const emailHeader = userEmail.trim() || 'unknown@vegvisr.org';
    headers.set('x-user-id', trimmedUser);
    headers.set('x-user-email', emailHeader);
    headers.set('x-user-role', 'Superadmin');

    return fetch(`${CHAT_HISTORY_BASE_URL}${path}`, {
      ...options,
      headers
    });
  };

  const getStoredSessionId = () => {
    if (!sessionStorageKey) return null;
    try {
      return localStorage.getItem(sessionStorageKey);
    } catch {
      return null;
    }
  };

  const persistSessionIdLocally = (sessionId: string) => {
    if (!sessionStorageKey || !sessionId) return;
    try {
      localStorage.setItem(sessionStorageKey, sessionId);
    } catch {
      /* ignore */
    }
  };

  const clearStoredSessionId = () => {
    if (!sessionStorageKey) return;
    try {
      localStorage.removeItem(sessionStorageKey);
    } catch {
      /* ignore */
    }
  };

  const historyLastLoadedLabel = useMemo(() => {
    if (!historyLastLoaded) return '';
    try {
      return new Date(historyLastLoaded).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  }, [historyLastLoaded]);

  const upsertSessionPreview = (session: { id: string; title?: string; updatedAt?: string }) => {
    if (!session?.id) return;
    setAvailableSessions((prev) => {
      const existingIndex = prev.findIndex((s) => s.id === session.id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], ...session };
        return next;
      }
      return [session, ...prev].slice(0, 50);
    });
  };

  const upsertChatSession = async (options: {
    sessionIdOverride?: string | null;
    customTitle?: string | null;
    skipStoredId?: boolean;
    preserveActiveSession?: boolean;
  } = {}) => {
    const {
      sessionIdOverride = null,
      customTitle = null,
      skipStoredId = false,
      preserveActiveSession = false
    } = options;
    if (!canPersistHistory) return null;

    const previousSessionId = chatSessionId;
    const payload: Record<string, unknown> = {
      graphId: GRAPH_IDENTIFIER,
      provider
    };
    const defaultSessionTitle = 'AI Chat Session';

    const cachedSessionId = (skipStoredId || !RESUME_SESSION_ON_LOAD) ? null : getStoredSessionId();
    const finalSessionId = sessionIdOverride || cachedSessionId;
    if (finalSessionId) {
      payload.sessionId = finalSessionId;
    }

    if (customTitle) {
      payload.title = customTitle;
    } else if (!finalSessionId) {
      payload.title = defaultSessionTitle;
    }

    const response = await authorizedHistoryFetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || 'Unable to create chat session');
    }

    const data = await response.json().catch(() => ({}));
    if (data?.session?.id) {
      const shouldPreserveActive = Boolean(
        preserveActiveSession &&
          sessionIdOverride &&
          previousSessionId &&
          sessionIdOverride !== previousSessionId
      );
      if (!shouldPreserveActive) {
        chatSessionIdRef.current = data.session.id;
        setChatSessionId(data.session.id);
        persistSessionIdLocally(data.session.id);
      }
      upsertSessionPreview(data.session);
    }
    return data.session || null;
  };

  const loadChatHistory = async (
    keySnapshot: string | null,
    sessionIdOverride: string | null = null
  ) => {
    const activeSessionId = sessionIdOverride || chatSessionIdRef.current || chatSessionId;
    if (!activeSessionId) return false;
    const params = new URLSearchParams({
      sessionId: activeSessionId,
      decrypt: '1',
      limit: '200'
    });
    const response = await authorizedHistoryFetch(`/messages?${params.toString()}`, {
      method: 'GET'
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || 'Unable to load chat history');
    }
    const data = await response.json().catch(() => ({}));
    const rawMessages = data.messages || [];
    const sortedRaw = [...rawMessages].sort((a, b) => {
      const aTs = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bTs = b.createdAt ? Date.parse(b.createdAt) : 0;
      return aTs - bTs;
    });
    let fallbackProvider = provider;
    const normalized = sortedRaw.map((message) => {
      const timestamp = message.createdAt ? Date.parse(message.createdAt) : Date.now();
      const resolvedProvider = message.provider || (message.role === 'assistant' ? fallbackProvider : provider);
      if (message.role === 'assistant' && message.provider) {
        fallbackProvider = message.provider;
      }
      return {
        id: message.id || crypto.randomUUID(),
        role: message.role || 'assistant',
        content: message.content || '',
        provider: resolvedProvider,
        imageData: message.imageData || null,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now()
      };
    });

    if (sessionStorageKey !== keySnapshot) {
      return false;
    }
    setMessages(normalized);
    setHistoryLastLoaded(new Date().toISOString());
    scrollToBottom();
    const lastAssistant = [...normalized].reverse().find((msg) => msg.role === 'assistant' && msg.provider);
    if (lastAssistant?.provider) {
      setProvider(lastAssistant.provider);
    }
    return true;
  };

  const fetchChatSessions = async () => {
    if (!canPersistHistory) return;
    setSessionsLoading(true);
    setSessionsError('');
    try {
      const params = new URLSearchParams();
      params.set('graphId', GRAPH_IDENTIFIER);
      const response = await authorizedHistoryFetch(`/sessions?${params.toString()}`, {
        method: 'GET'
      });
      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to load sessions');
      }
      const data = await response.json().catch(() => ({}));
      setAvailableSessions(data.sessions || []);
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : 'Failed to load sessions');
    } finally {
      setSessionsLoading(false);
    }
  };

  const initializeChatHistory = async (forceReload = false, keySnapshot: string | null = sessionStorageKey) => {
    if (!canPersistHistory || !keySnapshot) return;
    if (sessionInitPromise.current && !forceReload) {
      await sessionInitPromise.current;
      return;
    }
    sessionInitPromise.current = (async () => {
      setHistoryLoading(true);
      setHistoryError('');
      try {
        fetchChatSessions();
        const cachedSessionId = getStoredSessionId();
        if (cachedSessionId) {
          chatSessionIdRef.current = cachedSessionId;
          setChatSessionId(cachedSessionId);
          await loadChatHistory(keySnapshot, cachedSessionId);
        }
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : 'Failed to load chat history');
      } finally {
        setHistoryLoading(false);
        sessionInitPromise.current = null;
      }
    })();
    await sessionInitPromise.current;
  };

  const startNewChatSession = async () => {
    if (!canPersistHistory || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError('');
    setSessionListOpen(false);
    setMessages([]);
    setHistoryLastLoaded(null);
    chatSessionIdRef.current = null;
    setChatSessionId(null);
    clearStoredSessionId();
    try {
      await fetchChatSessions();
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Failed to start new session');
    } finally {
      setHistoryLoading(false);
    }
  };

  const deleteChatSession = async (session: { id: string; title?: string }) => {
    if (!session?.id || deletingSessionId === session.id) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Delete session "${session.title || 'Untitled session'}"?`);
      if (!confirmed) return;
    }
    setDeleteSessionError('');
    setDeletingSessionId(session.id);
    try {
      const response = await authorizedHistoryFetch(`/sessions/${session.id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to delete session');
      }
      setAvailableSessions((prev) => prev.filter((s) => s.id !== session.id));
      if (chatSessionId === session.id) {
        chatSessionIdRef.current = null;
        setChatSessionId(null);
        clearStoredSessionId();
        setMessages([]);
        setHistoryLastLoaded(null);
      }
      await fetchChatSessions();
    } catch (error) {
      setDeleteSessionError(error instanceof Error ? error.message : 'Failed to delete session');
    } finally {
      setDeletingSessionId((current) => (current === session.id ? null : current));
    }
  };

  const beginRenameSession = (session: { id: string; title?: string }) => {
    if (!session) return;
    setRenamingSessionId(session.id);
    setRenameInput(session.title || 'Untitled session');
    setRenameError('');
  };

  const cancelRenameSession = () => {
    setRenamingSessionId(null);
    setRenameInput('');
    setRenameError('');
  };

  const confirmRenameSession = async (sessionId: string) => {
    if (!sessionId || renamingSessionId !== sessionId) return;
    const trimmedTitle = renameInput.trim();
    if (!trimmedTitle) {
      setRenameError(t('chat.sessionRenameRequired'));
      return;
    }
    setRenameSaving(true);
    setRenameError('');
    try {
      const preserveActive = chatSessionId !== sessionId;
      const session = await upsertChatSession({
        sessionIdOverride: sessionId,
        customTitle: trimmedTitle,
        preserveActiveSession: preserveActive
      });
      if (!session) {
        upsertSessionPreview({
          id: sessionId,
          title: trimmedTitle,
          updatedAt: new Date().toISOString()
        });
      }
      cancelRenameSession();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : t('chat.sessionRenameError'));
    } finally {
      setRenameSaving(false);
    }
  };

  const toggleSessionList = async () => {
    if (!canPersistHistory) return;
    setSessionListOpen((prev) => !prev);
    setDeleteSessionError('');
    if (!sessionListOpen && availableSessions.length === 0) {
      await fetchChatSessions();
    }
    if (sessionListOpen) {
      cancelRenameSession();
    }
  };

  const selectChatSession = async (sessionId: string) => {
    if (!sessionId || sessionId === chatSessionId) {
      setSessionListOpen(false);
      return;
    }
    cancelRenameSession();
    setHistoryLoading(true);
    setHistoryError('');
    chatSessionIdRef.current = sessionId;
    setChatSessionId(sessionId);
    persistSessionIdLocally(sessionId);
    setMessages([]);
    try {
      await loadChatHistory(sessionStorageKey, sessionId);
      setSessionListOpen(false);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Failed to load chat history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const ensureSessionId = async () => {
    if (!canPersistHistory) return null;
    let sessionId = chatSessionIdRef.current;
    if (!sessionId) {
      const session = await upsertChatSession();
      sessionId = session?.id || chatSessionIdRef.current;
    }
    return sessionId || null;
  };

  const persistMessageWithSession = async (message: ChatMessage, sessionId: string) => {
    const hasContent = typeof message.content === 'string' && message.content.trim().length > 0;
    if (!hasContent && !message.imageData) {
      return;
    }
    const normalizedImageData = message.imageData
      ? {
          base64Data: message.imageData.base64Data ?? null,
          previewImageUrl: message.imageData.previewImageUrl ?? null,
          mimeType: message.imageData.mimeType || 'image/png',
          revisedPrompt: message.imageData.revisedPrompt ?? null,
          imageType: message.imageData.imageType,
          originalPrompt: message.imageData.originalPrompt,
          fullImageUrl: message.imageData.fullImageUrl ?? null,
          model: message.imageData.model,
          prompt: message.imageData.prompt,
          size: message.imageData.size,
          quality: message.imageData.quality
        }
      : null;
    let imageDataForPersist = normalizedImageData;
    if (imageDataForPersist?.base64Data && imageDataForPersist.base64Data.length > MAX_PERSIST_BASE64_LENGTH) {
      const compressed = await compressBase64Image(
        imageDataForPersist.base64Data,
        imageDataForPersist.mimeType || 'image/png'
      );
      if (compressed?.base64) {
        imageDataForPersist = {
          ...imageDataForPersist,
          base64Data: compressed.base64,
          mimeType: compressed.mimeType
        };
      } else if (imageDataForPersist.previewImageUrl) {
        imageDataForPersist = {
          ...imageDataForPersist,
          base64Data: null
        };
      }
    }
    const payload: Record<string, unknown> = {
      sessionId,
      role: message.role
    };
    if (message.id) {
      payload.messageId = message.id;
    }
    if (message.role === 'assistant' && message.provider) {
      payload.provider = message.provider;
    }
    if (imageDataForPersist && (imageDataForPersist.base64Data || imageDataForPersist.previewImageUrl)) {
      payload.imageData = imageDataForPersist;
    }
    if (message.content) {
      payload.content = message.content;
    } else if (normalizedImageData) {
      payload.content = '[image]';
    } else {
      return;
    }
    const response = await authorizedHistoryFetch('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || 'Failed to persist chat message');
    }
    const data = await response.json().catch(() => ({}));
    if (data?.message?.id && !message.id) {
      message.id = data.message.id;
    }
    upsertSessionPreview({
      id: sessionId,
      updatedAt: new Date().toISOString()
    });
  };

  const persistMessagesAfterAssistant = async (userMessage: ChatMessage | null, assistantMessage: ChatMessage) => {
    try {
      const sessionId = await ensureSessionId();
      if (!sessionId) return;
      if (userMessage) {
        await persistMessageWithSession(userMessage, sessionId);
      }
      await persistMessageWithSession(assistantMessage, sessionId);
    } catch (error) {
      console.warn('Chat history persistence error:', error);
    }
  };

  const appendChatMessage = (message: ChatMessage, options: { persist?: boolean } = {}) => {
    setMessages((prev) => [...prev, message]);
    scrollToBottom();
    if (options.persist === false) {
      return;
    }
    if (message.role === 'assistant') {
      persistMessagesAfterAssistant(null, message);
    }
  };

  useEffect(() => {
    if (!canPersistHistory || !sessionStorageKey) {
      chatSessionIdRef.current = null;
      setChatSessionId(null);
      setHistoryLoading(false);
      setHistoryError('');
      setAvailableSessions([]);
      setSessionListOpen(false);
      cancelRenameSession();
      setDeleteSessionError('');
      return;
    }

    const shouldForceReload = lastInitializedSessionKey.current !== sessionStorageKey;
    if (shouldForceReload) {
      if (chatSessionIdRef.current && messages.length === 0) {
        authorizedHistoryFetch(`/sessions/${chatSessionIdRef.current}`, {
          method: 'DELETE'
        }).catch(() => null);
      }
      setMessages([]);
      setAvailableSessions([]);
      chatSessionIdRef.current = null;
      setChatSessionId(null);
      clearStoredSessionId();
    }
    lastInitializedSessionKey.current = sessionStorageKey;
    initializeChatHistory(shouldForceReload, sessionStorageKey);
  }, [canPersistHistory, sessionStorageKey]);

  const processImageFile = async (file: File) => {
    if (!providerSupportsImages) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== 'string') return;
      const base64 = result.split(',')[1] || null;
      setUploadedImage({
        file,
        preview: result,
        base64,
        mimeType: file.type || 'image/jpeg'
      });
    };
    reader.readAsDataURL(file);
  };

  const processImageUrl = async (url: string) => {
    if (!providerSupportsImages) {
      return;
    }

    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      const blob = await response.blob();
      const mimeType = blob.type || 'image/jpeg';
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result !== 'string') return;
        const base64 = result.split(',')[1] || null;
        setUploadedImage({
          file: null,
          preview: url,
          base64,
          mimeType,
          sourceUrl: url
        });
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      setUploadedImage({
        file: null,
        preview: url,
        base64: null,
        mimeType: 'image/jpeg',
        sourceUrl: url,
        isUrlOnly: true
      });
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      await processImageFile(file);
    }
    event.target.value = '';
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLInputElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await processImageFile(file);
        }
        return;
      }
    }

    const text = event.clipboardData.getData('text/plain');
    if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
      const isImageUrl = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(text);
      if (isImageUrl) {
        event.preventDefault();
        await processImageUrl(text);
      }
    }
  };

  const handleDragEnter = () => {
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);

    const urlData =
      event.dataTransfer.getData('text/uri-list') ||
      event.dataTransfer.getData('text/plain');
    if (urlData && (urlData.startsWith('http://') || urlData.startsWith('https://'))) {
      const isImageUrl = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(urlData);
      if (isImageUrl) {
        await processImageUrl(urlData);
        return;
      }
    }

    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      await processImageFile(file);
      return;
    }
    if (file && isSupportedAudioFile(file)) {
      await processDroppedAudio(file);
    }
  };

  const isSupportedAudioFile = (file: File) => {
    if (!file) return false;
    if (file.type && SUPPORTED_AUDIO_MIME_TYPES.has(file.type.toLowerCase())) {
      return true;
    }
    const extension = file.name?.toLowerCase().substring(file.name.lastIndexOf('.'));
    return extension ? SUPPORTED_AUDIO_EXTENSIONS.includes(extension) : false;
  };

  const inferMimeTypeFromExtension = (fileName = '') => {
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    switch (extension) {
      case '.mp3':
        return 'audio/mpeg';
      case '.wav':
        return 'audio/wav';
      case '.m4a':
        return 'audio/mp4';
      case '.ogg':
        return 'audio/ogg';
      case '.opus':
        return 'audio/opus';
      case '.aac':
        return 'audio/aac';
      case '.mp4':
        return 'video/mp4';
      case '.webm':
        return 'video/webm';
      default:
        return 'audio/wav';
    }
  };

  const getAudioDurationSeconds = (file: File) => {
    return new Promise<number>((resolve, reject) => {
      try {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
          URL.revokeObjectURL(audio.src);
          resolve(audio.duration || 0);
        };
        audio.onerror = (event) => {
          URL.revokeObjectURL(audio.src);
          reject((event as ErrorEvent).error || new Error('Unable to read audio metadata'));
        };
        audio.src = URL.createObjectURL(file);
      } catch (err) {
        reject(err as Error);
      }
    });
  };

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  };

  const formatDuration = (seconds: number | null) => {
    if (!Number.isFinite(seconds) || seconds === null || seconds < 0) return t('chat.audioDurationUnknown');
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const processDroppedAudio = async (file: File) => {
    setAudioTranscriptionStatus('');
    setAudioChunkProgress({ current: 0, total: 0 });
    try {
      const duration = await getAudioDurationSeconds(file).catch(() => null);
      setSelectedAudioFile({
        file,
        name: file.name || 'audio-file',
        size: file.size,
        type: file.type || inferMimeTypeFromExtension(file.name),
        duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null
      });
      setAudioAutoDetect(true);
      setAudioLanguage('no');
    } catch (err) {
      setSelectedAudioFile(null);
    }
  };

  const handleAudioFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isSupportedAudioFile(file)) {
      setAudioTranscriptionStatus(t('chat.audioUnsupported'));
      return;
    }

    setAudioTranscriptionStatus('');
    setAudioChunkProgress({ current: 0, total: 0 });

    try {
      const duration = await getAudioDurationSeconds(file).catch(() => null);
      setSelectedAudioFile({
        file,
        name: file.name || 'audio-file',
        size: file.size,
        type: file.type || inferMimeTypeFromExtension(file.name),
        duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null
      });
      setAudioAutoDetect(true);
      setAudioLanguage('no');
    } catch (err) {
      setSelectedAudioFile(null);
      setAudioTranscriptionStatus(t('chat.audioReadFailed'));
    }
  };

  const clearSelectedAudio = () => {
    setSelectedAudioFile(null);
    setAudioProcessing(false);
    setAudioTranscriptionStatus('');
    setAudioChunkProgress({ current: 0, total: 0 });
  };

  const callWhisperTranscription = async (blob: Blob, fileName: string) => {
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('model', 'whisper-1');
    const requiredUserId = getRequiredUserId();
    if (!requiredUserId) {
      throw new Error('Sign in required');
    }
    formData.append('userId', requiredUserId);
    if (!audioAutoDetect && audioLanguage) {
      formData.append('language', audioLanguage);
    }

    const response = await fetch(AUDIO_ENDPOINT, {
      method: 'POST',
      body: formData
    });

    const payloadText = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const detail = parsed?.error || parsed?.message || payloadText || 'Audio transcription failed';
      throw new Error(typeof detail === 'string' ? detail : 'Audio transcription failed');
    }

    return parsed || { text: payloadText };
  };

  const transcribeSingleAudio = async (file: File, fileName: string) => {
    setAudioTranscriptionStatus(t('chat.audioUploading'));
    const result = await callWhisperTranscription(file, fileName);
    const transcript = (result.text || '').trim();
    setStreamingContent(transcript);
    scrollToBottom();
    return {
      text: transcript,
      language: result.language || (audioAutoDetect ? 'auto' : audioLanguage)
    };
  };

  const sanitizeFileBaseName = (name = '') => {
    if (!name.includes('.')) return name;
    return name.substring(0, name.lastIndexOf('.'));
  };

  const formatChunkTimestamp = (seconds = 0) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const audioBufferToWavBlob = (audioBuffer: AudioBuffer) => {
    return new Promise<Blob>((resolve) => {
      const numberOfChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const length = audioBuffer.length;
      const buffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
      const view = new DataView(buffer);

      const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + length * numberOfChannels * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numberOfChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numberOfChannels * 2, true);
      view.setUint16(32, numberOfChannels * 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, length * numberOfChannels * 2, true);

      let offset = 44;
      for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
          view.setInt16(offset, sample * 0x7fff, true);
          offset += 2;
        }
      }

      resolve(new Blob([buffer], { type: 'audio/wav' }));
    });
  };

  const splitAudioIntoChunks = async (
    file: File,
    chunkDurationSeconds = CHUNK_DURATION_SECONDS,
    onProgress?: (progress: { phase: string; current?: number; total?: number }) => void
  ) => {
    if (typeof window === 'undefined') {
      throw new Error('Audio processing is only available in the browser');
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('This browser does not support audio processing APIs');
    }

    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContextClass();

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const sampleRate = audioBuffer.sampleRate;
      const chunkSamples = chunkDurationSeconds * sampleRate;
      const totalSamples = audioBuffer.length;
      const totalChunks = Math.max(Math.ceil(totalSamples / chunkSamples), 1);

      onProgress?.({ phase: 'info', total: totalChunks });

      const chunks: Array<{ blob: Blob; startTime: number; endTime: number }> = [];
      for (let i = 0; i < totalChunks; i++) {
        const startSample = i * chunkSamples;
        const endSample = Math.min(startSample + chunkSamples, totalSamples);
        const chunkLength = endSample - startSample;
        const chunkBuffer = audioContext.createBuffer(
          audioBuffer.numberOfChannels,
          chunkLength,
          sampleRate
        );

        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
          const channelData = audioBuffer.getChannelData(channel);
          const chunkData = chunkBuffer.getChannelData(channel);
          for (let sample = 0; sample < chunkLength; sample++) {
            chunkData[sample] = channelData[startSample + sample];
          }
        }

        const blob = await audioBufferToWavBlob(chunkBuffer);
        chunks.push({
          blob,
          startTime: startSample / sampleRate,
          endTime: endSample / sampleRate
        });

        onProgress?.({ phase: 'creating', current: i + 1, total: totalChunks });
      }

      return chunks;
    } finally {
      await audioContext.close();
    }
  };

  const transcribeAudioInChunks = async (file: File, fileName: string) => {
    setAudioTranscriptionStatus(t('chat.audioChunking'));
    const chunks = await splitAudioIntoChunks(file, CHUNK_DURATION_SECONDS, (progress) => {
      if (progress.phase === 'creating') {
        setAudioTranscriptionStatus(
          `${t('chat.audioPreparingChunk')} ${progress.current}/${progress.total}...`
        );
      }
    });

    if (!chunks.length) {
      throw new Error('Audio could not be chunked for transcription');
    }

    setAudioChunkProgress({ current: 0, total: chunks.length });
    setStreamingContent('');
    const combinedSegments: string[] = [];
    const detectedLanguages = new Set<string>();
    const baseName = sanitizeFileBaseName(fileName);

    for (let i = 0; i < chunks.length; i++) {
      setAudioChunkProgress({ current: i + 1, total: chunks.length });
      setAudioTranscriptionStatus(
        `${t('chat.audioProcessingChunk')} ${i + 1}/${chunks.length}...`
      );

      try {
        const chunkResult = await callWhisperTranscription(
          chunks[i].blob,
          `${baseName || 'audio'}_chunk_${i + 1}.wav`
        );

        const chunkText = (chunkResult.text || '').trim();
        const chunkLabel = `[${formatChunkTimestamp(chunks[i].startTime)} - ${formatChunkTimestamp(chunks[i].endTime)}]`;

        if (chunkText) {
          const formatted = `${chunkLabel} ${chunkText}`;
          combinedSegments.push(formatted);
          setStreamingContent((prev) => (prev ? `${prev}\n\n${formatted}` : formatted));
          scrollToBottom();
        }

        if (chunkResult.language) {
          detectedLanguages.add(chunkResult.language);
        }

        setAudioTranscriptionStatus(
          `${t('chat.audioChunkComplete')} ${i + 1}/${chunks.length}`
        );
      } catch (error) {
        const chunkLabel = `[${formatChunkTimestamp(chunks[i].startTime)} - ${formatChunkTimestamp(chunks[i].endTime)}]`;
        const errorText = `${chunkLabel} [Error: ${error instanceof Error ? error.message : 'unknown error'}]`;
        combinedSegments.push(errorText);
        setStreamingContent((prev) => (prev ? `${prev}\n\n${errorText}` : errorText));
        setAudioTranscriptionStatus(
          `${t('chat.audioChunkFailed')} ${i + 1}/${chunks.length}`
        );
      }
    }

    return {
      text: combinedSegments.join('\n\n'),
      language:
        detectedLanguages.size === 1
          ? Array.from(detectedLanguages)[0]
          : (audioAutoDetect ? 'auto' : audioLanguage)
    };
  };

  const finalizeTranscriptionMessage = (result: { text: string; language: string }, fileName: string) => {
    const transcript = (result?.text || '').trim();
    const languageLabel =
      audioLanguageOptions.find((opt) => opt.code === result?.language)?.label || result?.language;
    const content = [
      `🎧 ${t('chat.audioTranscriptionFor')} **${fileName}**`,
      languageLabel ? `${t('chat.audioLanguageLabel')} ${languageLabel}` : null,
      transcript || t('chat.audioNoSpeech')
    ]
      .filter(Boolean)
      .join('\n\n');
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      provider: 'openai'
    };
    appendChatMessage(assistantMessage, { persist: false });
    return assistantMessage;
  };

  const startAudioTranscription = async () => {
    if (!selectedAudioFile || audioProcessing) return;
    if (!getRequiredUserId()) return;

    setAudioProcessing(true);
    setAudioTranscriptionStatus(t('chat.audioPreparing'));
    setAudioChunkProgress({ current: 0, total: 0 });

    const { file, name } = selectedAudioFile;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `${t('chat.audioUploadedMessage')} "${name}".`,
      provider
    };
    appendChatMessage(userMessage, { persist: false });

    setIsStreaming(true);
    setStreamingContent('');

    try {
      const duration = selectedAudioFile.duration ?? (await getAudioDurationSeconds(file).catch(() => null));
      const hasDuration = typeof duration === 'number' && Number.isFinite(duration);
      const shouldChunk = hasDuration ? duration > CHUNK_DURATION_SECONDS : file.size > 8 * 1024 * 1024;

      let result;
      try {
        result = shouldChunk
          ? await transcribeAudioInChunks(file, name)
          : await transcribeSingleAudio(file, name);
      } catch (error) {
        if (shouldChunk) {
          setAudioTranscriptionStatus(t('chat.audioChunkRetry'));
          result = await transcribeSingleAudio(file, name);
        } else {
          throw error;
        }
      }

    const assistantMessage = finalizeTranscriptionMessage(result, name);
    await persistMessagesAfterAssistant(userMessage, assistantMessage);
    clearSelectedAudio();
    } catch (error) {
      setAudioTranscriptionStatus(
        `${t('chat.audioTranscriptionFailed')}: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    } finally {
      setAudioProcessing(false);
      setAudioTranscriptionStatus('');
      setAudioChunkProgress({ current: 0, total: 0 });
      setIsStreaming(false);
      setStreamingContent('');
    }
  };

  const audioLanguageOptions = [
    { code: 'no', label: 'Norwegian' },
    { code: 'en', label: 'English' },
    { code: 'sv', label: 'Swedish' },
    { code: 'da', label: 'Danish' },
    { code: 'de', label: 'German' },
    { code: 'fr', label: 'French' },
    { code: 'es', label: 'Spanish' },
    { code: 'it', label: 'Italian' }
  ];
  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!getRequiredUserId()) return;

    if (isOpenAIImageModel) {
      if (uploadedImage) {
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: trimmed
        };
        appendChatMessage(userMessage, { persist: false });
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'Image models cannot analyze images. Switch to a chat model (e.g. GPT-5.2) for image analysis.'
        };
        appendChatMessage(assistantMessage, { persist: false });
        await persistMessagesAfterAssistant(userMessage, assistantMessage);
        setInput('');
        return;
      }
      await handleImageGeneration(trimmed);
      setInput('');
      return;
    }

    const hasImage = Boolean(uploadedImage && providerSupportsImages);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: hasImage ? `${trimmed} [Image attached]` : trimmed,
      imageData: hasImage
        ? {
            base64Data: uploadedImage?.base64 ?? null,
            previewImageUrl: uploadedImage?.preview ?? null,
            mimeType: uploadedImage?.mimeType ?? 'image/png'
          }
        : undefined
    };

    appendChatMessage(userMessage, { persist: false });
    setInput('');

    try {
      const localCommandResult = await executeLocalGraphCommand(trimmed);
      if (localCommandResult.handled) {
        const assistantMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: localCommandResult.response || 'Command executed.',
          provider
        } as ChatMessage;
        appendChatMessage(assistantMessage, { persist: false });
        await persistMessagesAfterAssistant(userMessage, assistantMessage);
        return;
      }
    } catch (error) {
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `[Local graph command failed: ${error instanceof Error ? error.message : 'unknown error'}]`,
        provider
      } as ChatMessage;
      appendChatMessage(assistantMessage, { persist: false });
      await persistMessagesAfterAssistant(userMessage, assistantMessage);
      return;
    }

    const assistantContent = await sendToProvider(trimmed, [...messages, userMessage]);
    if (assistantContent) {
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: assistantContent,
        provider
      } as ChatMessage;
      appendChatMessage(assistantMessage, { persist: false });
      await persistMessagesAfterAssistant(userMessage, assistantMessage);
    }
  };

  const handleImageGeneration = async (prompt: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Generating image...'
    };
    appendChatMessage(userMessage, { persist: false });
    appendChatMessage(assistantMessage, { persist: false });
    setIsStreaming(true);

    try {
      const aspectMap: Record<string, string> = {
        '1:1': 'square',
        '16:9': 'landscape',
        '9:16': 'portrait'
      };
      const extractAspectRatio = (text: string) => {
        if (!text) return { aspect: '1:1', cleaned: text };
        const match = text.match(/--ar\s*(\d+\s*:\s*\d+)/i);
        if (!match) return { aspect: '1:1', cleaned: text };
        const raw = match[1].replace(/\s+/g, '');
        const aspect = aspectMap[raw] ? raw : '1:1';
        const cleaned = text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();
        return { aspect, cleaned };
      };

      const { aspect, cleaned } = extractAspectRatio(prompt);
      const supportedImageModels = new Set(['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']);
      const selectedModel = supportedImageModels.has(openaiModel) ? openaiModel : 'gpt-image-1.5';
      const sizeByAspect: Record<string, Record<string, string>> = {
        'gpt-image-1-mini': {
          '1:1': '512x512',
          '16:9': '768x384',
          '9:16': '256x512'
        },
        'gpt-image-1': {
          '1:1': '1024x1024',
          '16:9': '1536x1024',
          '9:16': '1024x1536'
        },
        default: {
          '1:1': '1024x1024',
          '16:9': '1536x1024',
          '9:16': '1024x1536'
        }
      };
      const validImageSizes: Record<string, string[]> = {
        'gpt-image-1': ['1024x1024', '1536x1024', '1024x1536', 'auto'],
        'gpt-image-1.5': ['1024x1024', '1536x1024', '1024x1536', 'auto'],
        'gpt-image-1-mini': ['1024x1024', '1536x1024', '1024x1536', 'auto'],
        'dall-e-3': ['1024x1024', '1024x1792', '1792x1024'],
        'dall-e-2': ['256x256', '512x512', '1024x1024']
      };
      const aspectSizes = sizeByAspect[selectedModel] || sizeByAspect.default;
      const requestedSize = aspectSizes[aspect] || aspectSizes['1:1'];
      const modelSizes = validImageSizes[selectedModel] || [aspectSizes['1:1']];
      const size = modelSizes.includes(requestedSize) ? requestedSize : modelSizes[0];

      const requiredUserId = getRequiredUserId();
      if (!requiredUserId) {
        throw new Error('Sign in required');
      }
      const response = await fetch('https://openai.vegvisr.org/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: requiredUserId,
          model: selectedModel,
          prompt: cleaned,
          size,
          quality: 'auto',
          n: 1
        })
      });

      if (!response.ok) {
        let errorDetail = `Image generation error: ${response.status}`;
        try {
          const errJson = await response.json();
          errorDetail = errJson.error?.message || errJson.error || JSON.stringify(errJson);
        } catch (_) {
          errorDetail = await response.text();
        }
        throw new Error(errorDetail);
      }

      const data = await response.json();
      const imageBase64 = data?.data?.[0]?.b64_json || null;
      const imageUrl = data?.data?.[0]?.url || null;
      const revisedPrompt = data?.data?.[0]?.revised_prompt || null;

      if (!imageBase64 && !imageUrl) {
        throw new Error('No image data in response');
      }

      let fullImageUrl: string | null = null;
      let previewBase64: string | null = imageBase64;
      let previewMimeType = 'image/png';
      if (!previewBase64 && imageUrl) {
        const fromUrl = await toBase64FromUrl(imageUrl);
        previewBase64 = fromUrl.base64;
        previewMimeType = fromUrl.mimeType;
      }
      if (previewBase64) {
        const preview = await compressBase64Image(previewBase64, previewMimeType, 512, 0.7);
        if (preview?.base64) {
          previewBase64 = preview.base64;
          previewMimeType = preview.mimeType;
        }
      }

      try {
        const uploadMimeType = imageBase64 ? 'image/png' : previewMimeType;
        const uploadPayload = previewBase64
          ? {
              base64Data: imageBase64 || previewBase64,
              mimeType: uploadMimeType
            }
          : null;
        if (uploadPayload?.base64Data) {
          const uploadResponse = await authorizedHistoryFetch('/session-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(uploadPayload)
          });
          if (uploadResponse.ok) {
            const uploadData = await uploadResponse.json().catch(() => ({}));
            fullImageUrl = uploadData?.url || null;
          }
        }
      } catch (error) {
        console.warn('Image upload failed:', error);
      }

      const imageData = {
        base64Data: previewBase64,
        previewImageUrl: fullImageUrl || imageUrl,
        fullImageUrl: fullImageUrl || null,
        mimeType: previewMimeType,
        model: selectedModel,
        prompt: cleaned,
        revisedPrompt,
        size,
        quality: 'auto',
        imageType: 'standalone'
      };

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? { ...msg, content: `🖼️ ${prompt}`, imageData }
            : msg
        )
      );
      const finalizedAssistant = {
        ...assistantMessage,
        content: `🖼️ ${prompt}`,
        imageData,
        provider
      };
      await persistMessagesAfterAssistant(userMessage, finalizedAssistant);
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? {
                ...msg,
                content: `[API call failed: ${
                  error instanceof Error ? error.message : 'unknown error'
                }]`
              }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const sendToProvider = async (prompt: string, messageSnapshot: ChatMessage[]) => {
    const endpoint = CHAT_ENDPOINTS[provider] || CHAT_ENDPOINTS.grok;
    const hasImage = Boolean(uploadedImage && providerSupportsImages);
    const userContent = hasImage
      ? provider === 'claude'
        ? [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: uploadedImage?.mimeType || 'image/jpeg',
                data: uploadedImage?.base64 || ''
              }
            },
            { type: 'text', text: prompt }
          ]
        : [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: uploadedImage?.preview || uploadedImage?.sourceUrl || ''
              }
            }
          ]
      : prompt;

    if (provider === 'claude' && hasImage && !uploadedImage?.base64) {
      return 'Image upload failed: Claude requires base64 image data. Please paste or upload the image again.';
    }

    const requiredUserId = getRequiredUserId();
    if (!requiredUserId) {
      return 'Sign in required to continue.';
    }
    const payload = {
      userId: requiredUserId,
      model: provider === 'openai' ? openaiModel : provider === 'claude' ? claudeModel : undefined,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Respond in English unless the user explicitly asks for another language.' },
        ...messageSnapshot.map((msg, index) => {
          const isLastUser = index === messageSnapshot.length - 1 && msg.role === 'user';
          if (isLastUser && hasImage) {
            return { role: msg.role, content: userContent };
          }
          return { role: msg.role, content: msg.content };
        })
      ],
      context: {
        useGraphContext,
        useSelectionContext
      },
      tools: {
        useProffTools,
        useSourcesTools,
        useTemplateTools
      },
      attachments: {
        imageName: uploadedImage?.file?.name || null,
        audioName: selectedAudioFile?.name || null
      },
      stream: false
    };

    try {
      setIsStreaming(true);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API error ${response.status}`);
      }

      const data = await response.json();
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        data?.message ||
        JSON.stringify(data);
      return content;
    } catch (error) {
      const fallback = buildStubResponse(prompt);
      return `${fallback}\n\n[API call failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }]`;
    } finally {
      setUploadedImage(null);
      setIsStreaming(false);
    }
  };

  const buildStubResponse = (prompt: string) => {
    const contextFlags = [
      useGraphContext ? 'graph context' : null,
      useSelectionContext ? 'selection context' : null,
      useProffTools ? 'proff tools' : null,
      useSourcesTools ? 'sources tools' : null,
      useTemplateTools ? 'template tools' : null
    ].filter(Boolean);

    const contextLine = contextFlags.length
      ? `Active tools: ${contextFlags.join(', ')}.`
      : 'No tools active.';

    const attachmentLine =
      uploadedImage || selectedAudioFile
        ? `Attachments: ${uploadedImage?.file?.name || ''} ${selectedAudioFile ? selectedAudioFile.name : ''}`.trim()
        : 'No attachments.';

    return `I received: "${prompt}"\n${contextLine}\n${attachmentLine}\nI will respond as ${providerLabel(
      provider
    )} once the API is connected.`;
  };

  const activeModelOptions = useMemo(() => {
    if (provider === 'openai') {
      return openaiModelOptions;
    }
    if (provider === 'claude') {
      return claudeModelOptions;
    }
    return [];
  }, [provider]);

  return (
    <section className="relative rounded-3xl border border-white/10 bg-white/5 shadow-2xl shadow-black/40">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-indigo-500/80 via-slate-900/40 to-purple-500/80 px-6 py-4 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-lg">
            ✦
          </div>
          <div>
            <h3 className="text-lg font-semibold">{t('chat.title')}</h3>
            <p className="text-xs text-white/70">{t('chat.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="h-9 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-semibold text-white"
          >
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))}
          </select>

          {activeModelOptions.length > 0 && (
            <select
              value={provider === 'openai' ? openaiModel : claudeModel}
              onChange={(event) =>
                provider === 'openai'
                  ? setOpenaiModel(event.target.value)
                  : setClaudeModel(event.target.value)
              }
              className="h-9 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-semibold text-white"
            >
              {activeModelOptions.map((option) => (
                <option key={option.value} value={option.value} className="text-slate-900">
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      <div
        className={`flex min-h-[360px] flex-1 flex-col gap-6 px-6 py-6 ${isDragOver ? 'ring-2 ring-sky-400/60' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <section className="rounded-2xl border border-white/10 bg-white/5 p-2 text-white/70">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setSettingsTab('assistant')}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                settingsTab === 'assistant'
                  ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-100'
                  : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              Assistant
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('import')}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                settingsTab === 'import'
                  ? 'border-sky-300/50 bg-sky-400/20 text-sky-100'
                  : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              HTML Import
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsTab('theme');
                setThemeStudioOpen(true);
              }}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                settingsTab === 'theme'
                  ? 'border-amber-300/50 bg-amber-400/20 text-amber-100'
                  : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              Theme Studio
            </button>
          </div>
        </section>

        {settingsTab === 'assistant' && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/70">
                {t('chat.settingsTitle')}
              </div>
              <p className="mt-1 text-xs text-white/50">{t('chat.contextHint')}</p>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen((prev) => !prev)}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20"
            >
              {settingsOpen ? t('chat.settingsHide') : t('chat.settingsShow')}
            </button>
          </div>
          {settingsOpen && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={useGraphContext}
                  onChange={(event) => setUseGraphContext(event.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-white/10"
                />
                {t('chat.contextTools')}
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={useSelectionContext}
                  onChange={(event) => setUseSelectionContext(event.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-white/10"
                />
                {t('chat.selectionContext')}
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={useProffTools}
                  onChange={(event) => setUseProffTools(event.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-white/10"
                />
                {t('chat.profileLookup')}
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={useSourcesTools}
                  onChange={(event) => setUseSourcesTools(event.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-white/10"
                />
                {t('chat.sourcesTools')}
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={useTemplateTools}
                  onChange={(event) => setUseTemplateTools(event.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-white/10"
                />
                {t('chat.templateTools')}
              </label>
            </div>
          )}
        </section>
        )}

        {settingsTab === 'import' && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/70">
                {t('chat.htmlImportTitle')}
              </div>
              <p className="mt-1 text-xs text-white/50">{t('chat.htmlImportSubtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setHtmlImportOpen((prev) => !prev);
                resetHtmlImportState();
              }}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20"
            >
              {htmlImportOpen ? t('chat.htmlImportHide') : t('chat.htmlImportShow')}
            </button>
          </div>

          {htmlImportOpen && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setHtmlImportMode('new')}
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    htmlImportMode === 'new'
                      ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-100'
                      : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                >
                  {t('chat.htmlImportModeNew')}
                </button>
                <button
                  type="button"
                  onClick={() => setHtmlImportMode('current')}
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    htmlImportMode === 'current'
                      ? 'border-sky-300/50 bg-sky-400/20 text-sky-100'
                      : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                >
                  {t('chat.htmlImportModeCurrent')}
                </button>
              </div>

              {htmlImportMode === 'current' && (
                <input
                  value={htmlImportTargetGraphId}
                  onChange={(event) => setHtmlImportTargetGraphId(event.target.value)}
                  type="text"
                  placeholder={t('chat.htmlImportTargetGraphPlaceholder')}
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                />
              )}

              <input
                value={htmlImportUrl}
                onChange={(event) => setHtmlImportUrl(event.target.value)}
                type="url"
                placeholder={t('chat.htmlImportUrlPlaceholder')}
                className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  value={htmlImportTitle}
                  onChange={(event) => setHtmlImportTitle(event.target.value)}
                  type="text"
                  placeholder={t('chat.htmlImportGraphTitlePlaceholder')}
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                />
                <input
                  value={htmlImportDescription}
                  onChange={(event) => setHtmlImportDescription(event.target.value)}
                  type="text"
                  placeholder={t('chat.htmlImportDescriptionPlaceholder')}
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleImportHtmlTemplate}
                  disabled={htmlImportLoading || !htmlImportUrl.trim()}
                  className="rounded-full border border-emerald-300/40 bg-emerald-400/15 px-4 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {htmlImportLoading ? t('chat.htmlImportImporting') : t('chat.htmlImportCta')}
                </button>
                {htmlImportGraphId && (
                  <button
                    type="button"
                    onClick={() => window.open(`https://www.vegvisr.org/gnew-viewer?graphId=${htmlImportGraphId}`, '_blank')}
                    className="rounded-full border border-sky-300/40 bg-sky-400/15 px-4 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-400/25"
                  >
                    {t('chat.htmlImportOpenGraph')}
                  </button>
                )}
              </div>

              {htmlImportError && (
                <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                  {htmlImportError}
                </div>
              )}
              {htmlImportGraphId && (
                <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                  <div>
                    {htmlImportMode === 'current' ? t('chat.htmlImportSuccessCurrent') : t('chat.htmlImportSuccess')}{' '}
                    <code className="font-mono">{htmlImportGraphId}</code>
                  </div>
                  {htmlImportStats && (
                    <div className="mt-1 text-[11px] text-emerald-200/80">
                      {t('chat.htmlImportStats')}: CSS {Math.round((htmlImportStats.cssBytes || 0) / 1024)} KB, HTML {Math.round((htmlImportStats.htmlBytes || 0) / 1024)} KB, Payload {Math.round((htmlImportStats.payloadBytes || 0) / 1024)} KB
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
        )}

        {settingsTab === 'theme' && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/70">
                Theme Studio
              </div>
              <p className="mt-1 text-xs text-white/50">
                Select a UI theme, then apply it to an HTML node with one click.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setThemeStudioOpen((prev) => !prev);
                resetThemeStudioState();
              }}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20"
            >
              {themeStudioOpen ? 'Hide theme studio' : 'Show theme studio'}
            </button>
          </div>

          {themeStudioOpen && (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/10 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-100">
                  Theme Graph (Source of truth)
                </div>
                <p className="mt-1 text-xs text-fuchsia-100/80">
                  Loads themes directly from the Theme Graph html-nodes. No KV sync needed.
                </p>
                <div className="mt-1 text-[11px] text-fuchsia-100/70">
                  {themeGraphCatalog.length} Theme Graph{themeGraphCatalog.length === 1 ? '' : 's'} available.
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <select
                    value={themeCatalogGraphId}
                    onChange={(event) => setThemeCatalogGraphId(event.target.value)}
                    onFocus={() => {
                      if (!themeGraphCatalogLoading) {
                        loadThemeGraphCatalog().catch(() => null);
                      }
                    }}
                    disabled={themeGraphCatalogLoading}
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40 focus:border-fuchsia-400/60 focus:outline-none"
                  >
                    {!themeGraphCatalogOptions.length ? (
                      <option value="">
                        {themeGraphCatalogLoading ? 'Loading Theme Graphs...' : 'No Theme Graphs found'}
                      </option>
                    ) : (
                      themeGraphCatalogOptions.map((item) => (
                        <option key={item.id} value={item.id} className="bg-slate-900 text-white">
                          {item.title} • {item.id}
                        </option>
                      ))
                    )}
                  </select>
                  <div className="text-[11px] text-fuchsia-100/70">
                    {themeCatalogLoading
                      ? 'Loading themes from selected Theme Graph...'
                      : 'Themes load automatically when you select a Theme Graph.'}
                  </div>
                </div>
                {themeGraphCatalogError && (
                  <div className="mt-2 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                    {themeGraphCatalogError}
                  </div>
                )}
                {themeCatalogError && (
                  <div className="mt-2 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                    {themeCatalogError}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-100">
                  Generate Theme With AI (GPT-5.2)
                </div>
                <p className="mt-1 text-xs text-amber-100/80">
                  Describe the vibe and palette. Vegvisr will generate a new Theme Studio template you can apply to HTML nodes.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setThemeAiMode('new')}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                      themeAiMode === 'new'
                        ? 'border-amber-300/50 bg-amber-400/20 text-amber-100'
                        : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    Create new theme
                  </button>
                  <button
                    type="button"
                    onClick={() => setThemeAiMode('remix')}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                      themeAiMode === 'remix'
                        ? 'border-amber-300/50 bg-amber-400/20 text-amber-100'
                        : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    Remix selected theme
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr]">
                  <input
                    value={themeAiLabel}
                    onChange={(event) => setThemeAiLabel(event.target.value)}
                    type="text"
                    placeholder="Theme name (optional)"
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-amber-400/60 focus:outline-none"
                  />
                  <input
                    value={themeAiGoogleFontUrl}
                    onChange={(event) => setThemeAiGoogleFontUrl(event.target.value)}
                    type="url"
                    placeholder="Google Fonts CSS URL (optional)"
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-amber-400/60 focus:outline-none"
                  />
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[auto_1fr]">
                  <button
                    type="button"
                    onClick={() => setThemeAiCreatePage((prev) => !prev)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                      themeAiCreatePage
                        ? 'border-amber-300/50 bg-amber-400/20 text-amber-100'
                        : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    Also create Theme Page node
                  </button>
                  <input
                    value={themeAiGraphId}
                    onChange={(event) => setThemeAiGraphId(event.target.value)}
                    type="text"
                    placeholder="Theme graph ID (where the html-node should be created)"
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40 focus:border-amber-400/60 focus:outline-none"
                  />
                </div>
                <input
                  value={themeAiHeroImageUrl}
                  onChange={(event) => setThemeAiHeroImageUrl(event.target.value)}
                  type="url"
                  placeholder="Hero image URL (optional, uses Unsplash if empty)"
                  className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-amber-400/60 focus:outline-none"
                />
                <textarea
                  value={themeAiPrompt}
                  onChange={(event) => setThemeAiPrompt(event.target.value)}
                  placeholder="Describe the theme: mood, colors, industry, style references, and any constraints."
                  className="mt-2 min-h-[90px] w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-amber-400/60 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-white/50">
                    Uses the OpenAI worker with model <code className="font-mono">gpt-5.2</code>.
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateThemeWithAi}
                    disabled={themeAiLoading || !themeAiPrompt.trim()}
                    className="rounded-full border border-amber-300/40 bg-amber-400/15 px-4 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {themeAiLoading ? 'Generating...' : 'Generate theme'}
                  </button>
                </div>
                {themeAiError && (
                  <div className="mt-2 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                    {themeAiError}
                  </div>
                )}
                {themeAiResult && (
                  <div className="mt-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                    Created theme <code className="font-mono">{themeAiResult.themeLabel}</code> (
                    <code className="font-mono">{themeAiResult.themeId}</code>).
                  </div>
                )}
                {themeAiPageResult && (
                  <div className="mt-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                    Created Theme Page html-node <code className="font-mono">{themeAiPageResult.htmlNodeId}</code> in graph{' '}
                    <code className="font-mono">{themeAiPageResult.graphId}</code>.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-sky-300/20 bg-sky-400/10 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-100">
                  Create Theme From URL
                </div>
                <p className="mt-1 text-xs text-sky-100/80">
                  Paste a website URL. Vegvisr will generate a new theme from that design style.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_auto]">
                  <input
                    value={themeSourceUrl}
                    onChange={(event) => setThemeSourceUrl(event.target.value)}
                    type="url"
                    placeholder="https://example.com/"
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                  />
                  <input
                    value={themeSourceLabel}
                    onChange={(event) => setThemeSourceLabel(event.target.value)}
                    type="text"
                    placeholder="Theme name (optional)"
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCreateThemeFromUrl}
                    disabled={themeCreateLoading || !themeSourceUrl.trim()}
                    className="rounded-full border border-sky-300/40 bg-sky-400/15 px-4 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {themeCreateLoading ? 'Creating...' : 'Create theme'}
                  </button>
                </div>
                {themeCreateError && (
                  <div className="mt-2 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                    {themeCreateError}
                  </div>
                )}
                {themeCreateResult && (
                  <div className="mt-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                    Created theme <code className="font-mono">{themeCreateResult.themeLabel}</code> (
                    <code className="font-mono">{themeCreateResult.themeId}</code>)
                    {themeCreateResult.hostname ? ` from ${themeCreateResult.hostname}` : ''}.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">
                  Import Theme From Graph
                </div>
                <p className="mt-1 text-xs text-emerald-100/80">
                  Read a graph CSS node and convert it into a reusable Theme Studio template.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input
                    value={themeImportGraphId}
                    onChange={(event) => setThemeImportGraphId(event.target.value)}
                    type="text"
                    placeholder="Graph ID"
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40 focus:border-emerald-400/60 focus:outline-none"
                  />
                  <input
                    value={themeImportCssNodeId}
                    onChange={(event) => setThemeImportCssNodeId(event.target.value)}
                    type="text"
                    placeholder="CSS node ID (optional)"
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40 focus:border-emerald-400/60 focus:outline-none"
                  />
                  <input
                    value={themeImportLabel}
                    onChange={(event) => setThemeImportLabel(event.target.value)}
                    type="text"
                    placeholder="Theme name (optional)"
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-emerald-400/60 focus:outline-none"
                  />
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={handleImportThemeFromGraph}
                    disabled={themeCreateLoading || !themeImportGraphId.trim()}
                    className="rounded-full border border-emerald-300/40 bg-emerald-400/15 px-4 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {themeCreateLoading ? 'Importing...' : 'Import from graph'}
                  </button>
                </div>
              </div>

              <input
                value={themeSearch}
                onChange={(event) => setThemeSearch(event.target.value)}
                type="text"
                placeholder="Search themes by name, id, or tag"
                className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setThemeFilterScope('all')}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    themeFilterScope === 'all'
                      ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-100'
                      : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                >
                  All themes
                </button>
                <button
                  type="button"
                  onClick={() => setThemeFilterScope('mine')}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    themeFilterScope === 'mine'
                      ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-100'
                      : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                >
                  My themes
                </button>
                <button
                  type="button"
                  onClick={() => setThemeFilterScope('shared')}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    themeFilterScope === 'shared'
                      ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-100'
                      : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                >
                  Shared themes
                </button>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.15em] text-white/50">Sort</span>
                  <button
                    type="button"
                    onClick={() => setThemeSortMode('newest')}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      themeSortMode === 'newest'
                        ? 'border-sky-300/50 bg-sky-400/20 text-sky-100'
                        : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    Newest
                  </button>
                  <button
                    type="button"
                    onClick={() => setThemeSortMode('most-used')}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      themeSortMode === 'most-used'
                        ? 'border-sky-300/50 bg-sky-400/20 text-sky-100'
                        : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    Most used
                  </button>
                  <button
                    type="button"
                    onClick={() => setThemeSortMode('mine-first')}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      themeSortMode === 'mine-first'
                        ? 'border-sky-300/50 bg-sky-400/20 text-sky-100'
                        : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    Mine first
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sortedThemeTemplates.map((theme) => {
                  const isSelected = selectedThemeTemplate.id === theme.id;
                  const isBuiltIn = builtInThemeIds.has(theme.id);
                  const isEditable = isCustomThemeEditable(theme);
                  const isOwnedByCurrentUser = !!(userId.trim() && theme.ownerUserId === userId.trim());
                  return (
                    <div
                      key={theme.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openThemePreviewModal(theme)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openThemePreviewModal(theme);
                        }
                      }}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        isSelected
                          ? 'border-emerald-300/60 bg-emerald-400/15'
                          : 'border-white/20 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">{theme.label}</span>
                        <span className="rounded-md border border-white/20 px-1.5 py-0.5 font-mono text-[10px] text-white/70">
                          {theme.id}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/60">
                          {isBuiltIn ? 'Built-in' : isOwnedByCurrentUser ? 'Mine' : 'Shared'}
                        </span>
                        {!isBuiltIn && (
                          <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/60">
                            {(theme.visibility || 'shared') === 'private' ? 'Private' : 'Shared'}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-white/60">{theme.description}</p>
                      <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-slate-900/40">
                        <iframe
                          title={`Theme preview ${theme.label}`}
                          srcDoc={theme.sourceHtml || buildThemePreviewHtml(theme, { variant: 'card' })}
                          loading="lazy"
                          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox allow-presentation"
                          className="h-36 w-full"
                        />
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        {theme.swatches.map((color) => (
                          <span
                            key={`${theme.id}-${color}`}
                            className="h-4 w-4 rounded-full border border-white/20"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      <div className="mt-2 text-[11px] text-white/50">
                        Used {themeUsageCounts[theme.id] || 0} time(s)
                      </div>
                      {!isBuiltIn && (
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              beginEditCustomTheme(theme);
                            }}
                            disabled={!isEditable}
                            className="rounded-full border border-sky-300/40 bg-sky-400/15 px-3 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteCustomTheme(theme);
                            }}
                            disabled={!isEditable}
                            className="rounded-full border border-rose-300/40 bg-rose-400/15 px-3 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {sortedThemeTemplates.length === 0 && (
                  <div className="rounded-xl border border-white/20 bg-white/5 px-3 py-4 text-xs text-white/60">
                    No theme templates match your search.
                  </div>
                )}
              </div>

              {editingThemeId && (
                <div className="rounded-xl border border-sky-300/30 bg-sky-400/10 px-3 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-100">
                    Edit Custom Theme
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <input
                      value={editingThemeLabel}
                      onChange={(event) => setEditingThemeLabel(event.target.value)}
                      type="text"
                      placeholder="Theme name"
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                    />
                    <select
                      value={editingThemeVisibility}
                      onChange={(event) =>
                        setEditingThemeVisibility(event.target.value === 'private' ? 'private' : 'shared')
                      }
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white focus:border-sky-400/60 focus:outline-none"
                    >
                      <option value="shared" className="bg-slate-900">
                        Shared
                      </option>
                      <option value="private" className="bg-slate-900">
                        Private
                      </option>
                    </select>
                    <input
                      value={editingThemeDescription}
                      onChange={(event) => setEditingThemeDescription(event.target.value)}
                      type="text"
                      placeholder="Description"
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none md:col-span-2"
                    />
                    <input
                      value={editingThemeTags}
                      onChange={(event) => setEditingThemeTags(event.target.value)}
                      type="text"
                      placeholder="Tags (comma separated)"
                      className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none md:col-span-2"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveEditedTheme}
                      disabled={editingThemeSaving}
                      className="rounded-full border border-emerald-300/40 bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {editingThemeSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditCustomTheme}
                      disabled={editingThemeSaving}
                      className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                  {editingThemeError && (
                    <div className="mt-2 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                      {editingThemeError}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <input
                  value={themeTargetGraphId}
                  onChange={(event) => setThemeTargetGraphId(event.target.value)}
                  type="text"
                  placeholder="Graph ID (target)"
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                />
                <input
                  value={themeTargetHtmlNodeId}
                  onChange={(event) => setThemeTargetHtmlNodeId(event.target.value)}
                  type="text"
                  placeholder="HTML node ID (required)"
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                />
                <input
                  value={themeCssNodeId}
                  onChange={(event) => setThemeCssNodeId(event.target.value)}
                  type="text"
                  placeholder="CSS node ID (optional, to reuse)"
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
                  AI HTML Class Contract
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {THEME_CONTRACT_CLASSES.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[11px] text-amber-100"
                    >
                      {item}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-amber-100/80">
                  Use these classes when asking AI to generate HTML, so any selected theme can style it consistently.
                </p>
                <button
                  type="button"
                  onClick={handleCopyThemePrompt}
                  className="mt-2 rounded-full border border-amber-300/40 bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-400/25"
                >
                  Copy AI prompt for selected theme
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleValidateThemeContract}
                  disabled={themeValidationLoading || !themeTargetHtmlNodeId.trim()}
                  className="rounded-full border border-amber-300/40 bg-amber-400/15 px-4 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {themeValidationLoading ? 'Validating...' : 'Validate contract'}
                </button>
                <button
                  type="button"
                  onClick={handleApplyThemeTemplateToAllNodes}
                  disabled={themeApplyLoading || !themeTargetGraphId.trim()}
                  className="rounded-full border border-emerald-300/40 bg-emerald-400/15 px-4 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {themeApplyLoading
                    ? 'Applying theme...'
                    : `Apply ${selectedThemeTemplate.label} to ALL HTML nodes`}
                </button>
                <button
                  type="button"
                  onClick={handleApplyThemeTemplate}
                  disabled={themeApplyLoading || !themeTargetHtmlNodeId.trim()}
                  className="rounded-full border border-emerald-300/40 bg-emerald-400/15 px-4 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {themeApplyLoading
                    ? 'Applying theme...'
                    : `Apply ${selectedThemeTemplate.label} to HTML node`}
                </button>
                {themeApplyResult && (
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `https://www.vegvisr.org/gnew-viewer?graphId=${themeApplyResult.graphId}`,
                        '_blank'
                      )
                    }
                    className="rounded-full border border-sky-300/40 bg-sky-400/15 px-4 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-400/25"
                  >
                    Open graph
                  </button>
                )}
              </div>

              {themeApplyError && (
                <div className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                  {themeApplyError}
                </div>
              )}

              {themeValidationResult && (
                <div
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    themeValidationResult.valid
                      ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
                      : 'border-amber-300/30 bg-amber-400/10 text-amber-100'
                  }`}
                >
                  <div>
                    Contract status:{' '}
                    <strong>{themeValidationResult.valid ? 'Valid (required classes present)' : 'Missing required classes'}</strong>
                  </div>
                  <div className="mt-1 text-[11px]">
                    Missing required: {themeValidationResult.missingRequiredClasses.join(', ') || 'none'}
                  </div>
                  <div className="mt-1 text-[11px]">
                    Missing optional: {themeValidationResult.missingOptionalClasses.join(', ') || 'none'}
                  </div>
                </div>
              )}

              {themeApplyResult && (
                <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                  {themeApplyResult.appliedHtmlNodeCount ? (
                    <div>
                      Applied <strong>{themeApplyResult.themeLabel}</strong> to{' '}
                      <strong>{themeApplyResult.appliedHtmlNodeCount}</strong> html node(s) in graph{' '}
                      <code className="font-mono">{themeApplyResult.graphId}</code>.
                    </div>
                  ) : (
                    <div>
                      Applied <strong>{themeApplyResult.themeLabel}</strong> to html-node{' '}
                      <code className="font-mono">{themeApplyResult.htmlNodeId}</code> in graph{' '}
                      <code className="font-mono">{themeApplyResult.graphId}</code>.
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-emerald-200/80">
                    CSS node in use: <code className="font-mono">{themeApplyResult.cssNodeId || 'created automatically'}</code>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
        )}

        {previewThemeTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
            <div className="w-full max-w-4xl rounded-2xl border border-white/20 bg-slate-900/95 p-4 text-white shadow-2xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{previewThemeTemplate.label}</div>
                  <div className="text-xs text-white/60">{previewThemeTemplate.description}</div>
                </div>
                <button
                  type="button"
                  onClick={closeThemePreviewModal}
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20"
                >
                  Close
                </button>
              </div>

              <div className="overflow-hidden rounded-xl border border-white/15 bg-slate-950/40">
                <iframe
                  title={`Theme modal preview ${previewThemeTemplate.label}`}
                  srcDoc={
                    previewThemeTemplate.sourceHtml ||
                    buildThemePreviewHtml(previewThemeTemplate, {
                      variant: 'modal',
                      imageUrl: themePreviewImageById[previewThemeTemplate.id] || null
                    })
                  }
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox allow-presentation"
                  className="h-[520px] w-full"
                />
              </div>

              {themePreviewImageLoading && (
                <div className="mt-2 text-xs text-sky-200/90">Loading random Unsplash preview image...</div>
              )}
              {themePreviewImageError && (
                <div className="mt-2 rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                  {themePreviewImageError}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setThemeSelectedId(previewThemeTemplate.id);
                    closeThemePreviewModal();
                    showToast(`Selected ${previewThemeTemplate.label}.`);
                  }}
                  className="rounded-full border border-emerald-300/40 bg-emerald-400/15 px-4 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/25"
                >
                  Use this theme
                </button>
              </div>
            </div>
          </div>
        )}

        {canPersistHistory && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {historyLoading && <span>{t('chat.historySyncing')}</span>}
                {!historyLoading && historyError && <span>⚠️ {historyError}</span>}
                {!historyLoading && !historyError && historyLastLoaded && (
                  <span>✅ {t('chat.historySynced')} {historyLastLoadedLabel}</span>
                )}
                {!historyLoading && !historyError && !historyLastLoaded && (
                  <span>{t('chat.historyWillSave')}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSessionList}
                  className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                >
                  {t('chat.sessions')} ({availableSessions.length})
                </button>
                <button
                  type="button"
                  onClick={startNewChatSession}
                  className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                  disabled={historyLoading || renameSaving}
                >
                  {t('chat.newSession')}
                </button>
              </div>
            </div>
            {sessionListOpen && (
              <div className="mt-4 space-y-3">
                {sessionsLoading && <div>{t('chat.sessionsLoading')}</div>}
                {!sessionsLoading && sessionsError && <div>⚠️ {sessionsError}</div>}
                {!sessionsLoading && !sessionsError && deleteSessionError && (
                  <div>⚠️ {deleteSessionError}</div>
                )}
                {!sessionsLoading && !sessionsError && !availableSessions.length && (
                  <div>{t('chat.sessionsEmpty')}</div>
                )}
                {!sessionsLoading && !sessionsError && availableSessions.length > 0 && (
                  <ul className="space-y-2">
                    {availableSessions.map((session) => (
                      <li
                        key={session.id}
                        className={`rounded-xl border border-white/10 p-3 ${
                          session.id === chatSessionId ? 'bg-white/10' : 'bg-white/5'
                        }`}
                      >
                        {renamingSessionId === session.id ? (
                          <div className="space-y-2">
                            <input
                              value={renameInput}
                              onChange={(event) => setRenameInput(event.target.value)}
                              className="w-full rounded-md border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                            />
                            {renameError && <div className="text-xs text-rose-300">{renameError}</div>}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => confirmRenameSession(session.id)}
                                disabled={renameSaving}
                                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                              >
                                {renameSaving ? t('chat.sessionRenaming') : t('chat.sessionRename')}
                              </button>
                              <button
                                type="button"
                                onClick={cancelRenameSession}
                                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                              >
                                {t('chat.sessionRenameCancel')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-semibold text-white/80">
                                {session.title || t('chat.sessionUntitled')}
                              </div>
                              <div className="text-[11px] text-white/50">
                                {t('chat.sessionUpdated')} {session.updatedAt || ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => selectChatSession(session.id)}
                                disabled={session.id === chatSessionId || historyLoading}
                                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                              >
                                {session.id === chatSessionId
                                  ? t('chat.sessionCurrent')
                                  : t('chat.sessionOpen')}
                              </button>
                              <button
                                type="button"
                                onClick={() => beginRenameSession(session)}
                                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                              >
                                {t('chat.sessionRename')}
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteChatSession(session)}
                                disabled={deletingSessionId === session.id}
                                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                              >
                                {deletingSessionId === session.id
                                  ? t('chat.sessionDeleting')
                                  : t('chat.sessionDelete')}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        
        <div className="flex-1 space-y-4 overflow-y-auto" ref={messagesContainerRef}>
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-sm text-white/70">
              {t('chat.emptyState')}
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-2xl px-4 py-3 text-sm shadow-lg shadow-black/20 ${
                  message.role === 'user'
                    ? 'ml-auto w-fit bg-sky-500/80 text-white'
                    : 'bg-white text-slate-900'
                }`}
              >
                {message.role === 'assistant' ? (
                  <MarkdownMessage
                    content={message.content}
                    textClassName={
                      responseFontSize === 'sm'
                        ? 'text-sm text-slate-900'
                        : responseFontSize === 'lg'
                          ? 'text-lg text-slate-900'
                          : 'text-base text-slate-900'
                    }
                  />
                ) : (
                  <span className="whitespace-pre-wrap">{message.content}</span>
                )}
                {message.imageData && (
                  <div className="mt-3">
                    <img
                      src={
                        imageLoadStates[message.id]
                          ? getFullImageUrl(message.imageData) || getImagePreviewUrl(message.imageData) || ''
                          : getImagePreviewUrl(message.imageData) || getFullImageUrl(message.imageData) || ''
                      }
                      alt="Generated"
                      className="max-h-64 rounded-xl border border-white/10 object-contain"
                      draggable
                      onDragStart={(event) => {
                        const fullUrl = getFullImageUrl(message.imageData);
                        const previewUrl = getImagePreviewUrl(message.imageData);
                        const url = fullUrl || previewUrl;
                        if (!url) return;
                        event.dataTransfer.setData('text/uri-list', url);
                        event.dataTransfer.setData('text/plain', url);
                      }}
                      onLoad={() => {
                        const fullUrl = getFullImageUrl(message.imageData);
                        const previewUrl = getImagePreviewUrl(message.imageData);
                        if (fullUrl && previewUrl && fullUrl !== previewUrl && !imageLoadStates[message.id]) {
                          setImageLoadStates((prev) => ({ ...prev, [message.id]: true }));
                        }
                      }}
                      onError={() => {
                        if (!imageLoadStates[message.id]) {
                          setImageLoadStates((prev) => ({ ...prev, [message.id]: true }));
                        }
                      }}
                    />
                  </div>
                )}
                {message.role === 'assistant' && extractFirstUrl(message.content) && (
                  <div className="mt-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70">
                    <div className="font-semibold text-white/80">{t('chat.linkPreview')}</div>
                    <a
                      href={extractFirstUrl(message.content) ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-sky-300 hover:text-sky-200"
                    >
                      {extractFirstUrl(message.content)}
                    </a>
                  </div>
                )}
              </div>
            ))
          )}
          {isStreaming && !streamingContent && (
            <div className="w-fit rounded-2xl bg-white/10 px-4 py-3 text-xs text-white/60">
              {t('chat.thinking')}
            </div>
          )}
        </div>

        {uploadedImage && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src={uploadedImage.preview}
                  alt="Uploaded"
                  className="h-24 w-24 rounded-xl object-cover"
                />
                <div className="text-xs text-white/70">
                  <div className="font-semibold text-white/80">{t('chat.imageAttached')}</div>
                  {uploadedImage.file?.name && (
                    <div className="mt-1 text-white/60">{uploadedImage.file.name}</div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUploadedImage(null)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                {t('chat.clearAttachments')}
              </button>
            </div>
          </div>
        )}

        {selectedAudioFile && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-white">{selectedAudioFile.name}</div>
                <div className="mt-1 text-white/60">
                  {formatFileSize(selectedAudioFile.size)}
                  {selectedAudioFile.duration !== null && (
                    <>
                      {' '}
                      • {t('chat.audioDurationLabel')} {formatDuration(selectedAudioFile.duration)}
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={clearSelectedAudio}
                disabled={audioProcessing}
                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-60"
              >
                ×
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={audioAutoDetect}
                  onChange={(event) => setAudioAutoDetect(event.target.checked)}
                  disabled={audioProcessing}
                  className="h-4 w-4 rounded border-white/30 bg-white/10"
                />
                {t('chat.audioAutoDetect')}
              </label>
              <select
                value={audioLanguage}
                onChange={(event) => setAudioLanguage(event.target.value)}
                disabled={audioAutoDetect || audioProcessing}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white"
              >
                {audioLanguageOptions.map((lang) => (
                  <option key={lang.code} value={lang.code} className="text-slate-900">
                    {lang.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={startAudioTranscription}
                disabled={audioProcessing}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs text-white/80 hover:bg-white/20 disabled:opacity-60"
              >
                {audioProcessing ? t('chat.audioTranscribing') : t('chat.audioTranscribe')}
              </button>
            </div>
            {audioTranscriptionStatus && (
              <div className="mt-3 text-xs text-white/60">
                {audioTranscriptionStatus}
                {audioChunkProgress.total > 0 && (
                  <span>
                    {' '}
                    • {t('chat.audioChunkLabel')} {audioChunkProgress.current}/{audioChunkProgress.total}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="sticky bottom-4 rounded-2xl border border-white/10 bg-slate-950/80 p-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
              {t('chat.message')}
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70">
                <span>{t('chat.responseFontSize')}</span>
                <select
                  value={responseFontSize}
                  onChange={(event) => setResponseFontSize(event.target.value as 'sm' | 'md' | 'lg')}
                  className="bg-transparent text-white focus:outline-none"
                >
                  <option value="sm" className="text-slate-900">{t('chat.fontSmall')}</option>
                  <option value="md" className="text-slate-900">{t('chat.fontMedium')}</option>
                  <option value="lg" className="text-slate-900">{t('chat.fontLarge')}</option>
                </select>
              </label>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <div className="flex w-full items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  if (!providerSupportsImages) {
                    showToast(t('chat.imageNotSupported'));
                    return;
                  }
                  imageInputRef.current?.click();
                }}
                className="rounded-full border border-white/20 bg-white/10 p-2 text-white/70 hover:bg-white/20"
                title={providerSupportsImages ? t('chat.fileAttach') : t('chat.fileAttachDisabled')}
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                disabled={audioProcessing}
                className="rounded-full border border-white/20 bg-white/10 p-2 text-white/70 hover:bg-white/20 disabled:opacity-50"
                title={t('chat.audioAttach')}
              >
                <Upload className="h-4 w-4" />
              </button>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    sendMessage();
                  }
                }}
                onPaste={handlePaste}
                placeholder={t('chat.messagePlaceholder')}
                className="w-full bg-transparent px-2 text-sm text-white placeholder:text-white/40 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={sendMessage}
              disabled={isStreaming}
              className="rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/30"
            >
              {isStreaming ? t('chat.streaming') : t('chat.send')}
            </button>
          </div>
          {toastMessage && (
            <div
              className="mt-3 rounded-xl border border-amber-300/40 bg-amber-100/10 px-3 py-2 text-sm text-amber-100"
              role="status"
              aria-live="polite"
            >
              {toastMessage}
            </div>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <input
            ref={audioInputRef}
            type="file"
            accept=".wav,.mp3,.m4a,.aac,.ogg,.opus,.mp4,.webm"
            disabled={audioProcessing}
            onChange={handleAudioFileSelect}
            className="hidden"
          />
        </div>
      </div>
    </section>
  );
};

export default GrokChatPanel;
