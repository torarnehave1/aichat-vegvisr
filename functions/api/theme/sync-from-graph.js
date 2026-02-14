const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

const normalizeHexColor = (value) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match) return '';
  return `#${match[1].toLowerCase()}`;
};

const readCssVar = (rootCss, name) => {
  const match = String(rootCss || '').match(new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'i'));
  return match ? match[1].trim() : '';
};

const extractRootCss = (html) => {
  const match = String(html || '').match(/:root\\s*\\{([\\s\\S]*?)\\}/i);
  return match ? match[1] : '';
};

const extractFirstGoogleFontUrl = (html) => {
  const match = String(html || '').match(/href=\"(https:\\/\\/fonts\\.googleapis\\.com[^\\\"]+)\"/i);
  return match ? match[1].trim() : '';
};

const extractPaletteFromHtml = (html) => {
  const items = [];
  const re =
    /<div[^>]*class=\"[^\"]*text-sm[^\"]*\"[^>]*>([^<]+)<\\/div>\\s*<div[^>]*class=\"[^\"]*text-xs[^\"]*\"[^>]*>(#[0-9a-fA-F]{3,8})<\\/div>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const name = String(m[1] || '').replace(/\\s+/g, ' ').trim();
    const hex = normalizeHexColor(m[2]);
    if (name && hex) items.push({ name, hex });
    if (items.length >= 10) break;
  }
  return items;
};

const normalizeThemeId = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const buildThemeTemplateFromHtmlNode = (node) => {
  const html = String(node?.info || '');
  const rootCss = extractRootCss(html);

  const bg = normalizeHexColor(readCssVar(rootCss, 'bg')) || '#0b1220';
  const surface = normalizeHexColor(readCssVar(rootCss, 'surface')) || '#0f172a';
  const surfaceElevated =
    normalizeHexColor(readCssVar(rootCss, 'elevated')) ||
    normalizeHexColor(readCssVar(rootCss, 'surfaceElevated')) ||
    '#111c33';
  const text = normalizeHexColor(readCssVar(rootCss, 'text')) || '#f8fafc';
  const muted = normalizeHexColor(readCssVar(rootCss, 'muted')) || '#94a3b8';
  const primary = normalizeHexColor(readCssVar(rootCss, 'primary')) || '#22d3ee';
  const primaryInk = normalizeHexColor(readCssVar(rootCss, 'primaryInk')) || '#0f172a';
  const border = normalizeHexColor(readCssVar(rootCss, 'border')) || '#334155';
  const radius = readCssVar(rootCss, 'radius') || '16px';
  const shadow = readCssVar(rootCss, 'shadow') || '0 22px 50px rgba(15, 23, 42, 0.4)';

  const fontFamily = readCssVar(rootCss, 'font') || '';
  const googleFontImportUrl = extractFirstGoogleFontUrl(html) || '';

  const palette = extractPaletteFromHtml(html);
  const swatches = palette.length
    ? palette.map((item) => item.hex).slice(0, 5)
    : [bg, surface, text, muted, primary];

  const label = String(node?.label || '').trim() || 'Theme';
  const id = String(node?.id || '').trim() || normalizeThemeId(label) || `theme-${Date.now()}`;

  return {
    id,
    label,
    description: 'Theme imported from theme graph.',
    tags: ['theme', 'graph', 'theme-page'],
    swatches,
    fontFamily: fontFamily || undefined,
    googleFontImportUrl: googleFontImportUrl || undefined,
    palette: palette.length ? palette : undefined,
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
    createdAt: String(node?.metadata?.createdAt || '') || null,
    updatedAt: new Date().toISOString(),
    sourceGraphId: null,
    sourceHtmlNodeId: id
  };
};

export async function onRequest(context) {
  const kv = context.env?.THEME_STUDIO_KV;
  if (!kv) {
    return jsonResponse({ success: false, message: 'THEME_STUDIO_KV binding is missing.' }, 500);
  }
  if (!context.env?.DOMAIN_WORKER) {
    return jsonResponse({ success: false, message: 'DOMAIN_WORKER service binding is missing.' }, 500);
  }
  if (context.request.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed.' }, 405);
  }

  const role = context.request.headers.get('x-user-role') || '';
  if (role !== 'Superadmin') {
    return jsonResponse({ success: false, message: 'Superadmin role required.' }, 403);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid JSON body.' }, 400);
  }

  const graphId = String(body?.graphId || '').trim();
  if (!graphId) {
    return jsonResponse({ success: false, message: 'graphId is required.' }, 400);
  }

  try {
    const upstreamUrl = `https://domain-worker/getknowgraph?id=${encodeURIComponent(graphId)}`;
    const upstreamRequest = new Request(upstreamUrl, {
      method: 'GET',
      headers: { Origin: 'https://www.vegvisr.org' }
    });
    const res = await context.env.DOMAIN_WORKER.fetch(upstreamRequest);
    const text = await res.text();
    const graph = text ? JSON.parse(text) : null;
    if (!res.ok || !graph) {
      throw new Error(`Failed to load graph (${res.status}).`);
    }

    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const themeNodes = nodes.filter((n) => String(n?.type || '').toLowerCase() === 'html-node');
    const themes = themeNodes
      .filter((n) => String(n?.info || '').includes('<!doctype') || String(n?.info || '').includes('<html'))
      .map((n) => buildThemeTemplateFromHtmlNode(n));

    await kv.put('theme-catalog:v1', JSON.stringify(themes));
    await kv.put(
      'theme-catalog-meta:v1',
      JSON.stringify({
        sourceGraphId: graphId,
        syncedAt: new Date().toISOString(),
        count: themes.length
      })
    );

    return jsonResponse({
      success: true,
      graphId,
      count: themes.length
    });
  } catch (error) {
    return jsonResponse(
      { success: false, message: error instanceof Error ? error.message : 'Sync failed.' },
      500
    );
  }
}

