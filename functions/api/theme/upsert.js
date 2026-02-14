const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

const normalizeThemeId = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export async function onRequest(context) {
  const kv = context.env?.THEME_STUDIO_KV;
  if (!kv) {
    return jsonResponse({ success: false, message: 'THEME_STUDIO_KV binding is missing.' }, 500);
  }
  if (context.request.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed.' }, 405);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid JSON body.' }, 400);
  }

  const theme = body?.theme && typeof body.theme === 'object' ? body.theme : null;
  if (!theme) {
    return jsonResponse({ success: false, message: 'Missing required field: theme' }, 400);
  }

  const id = String(theme.id || '').trim();
  const normalizedId = id || normalizeThemeId(theme.label || '') || '';
  if (!normalizedId) {
    return jsonResponse({ success: false, message: 'theme.id (or a valid label) is required.' }, 400);
  }

  try {
    const raw = await kv.get('theme-catalog:v1');
    const existing = raw ? JSON.parse(raw) : [];
    const catalog = Array.isArray(existing) ? existing : [];
    const nextTheme = {
      ...theme,
      id: normalizedId,
      updatedAt: new Date().toISOString()
    };

    const nextCatalog = [nextTheme, ...catalog.filter((item) => item?.id !== normalizedId)].slice(0, 300);
    await kv.put('theme-catalog:v1', JSON.stringify(nextCatalog));
    await kv.put(
      'theme-catalog-meta:v1',
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        updatedBy: 'upsert',
        count: nextCatalog.length
      })
    );

    return jsonResponse({ success: true, id: normalizedId, count: nextCatalog.length });
  } catch (error) {
    return jsonResponse(
      { success: false, message: error instanceof Error ? error.message : 'Upsert failed.' },
      500
    );
  }
}

