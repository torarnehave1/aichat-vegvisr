const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

export async function onRequest(context) {
  const kv = context.env?.THEME_STUDIO_KV;
  if (!kv) {
    return jsonResponse(
      {
        success: false,
        message: 'THEME_STUDIO_KV binding is missing.',
        themes: [],
        meta: null
      },
      500
    );
  }

  try {
    const raw = await kv.get('theme-catalog:v1');
    const metaRaw = await kv.get('theme-catalog-meta:v1');
    const themes = raw ? JSON.parse(raw) : [];
    const meta = metaRaw ? JSON.parse(metaRaw) : null;
    return jsonResponse({
      success: true,
      themes: Array.isArray(themes) ? themes : [],
      meta
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to read theme catalog.',
        themes: [],
        meta: null
      },
      500
    );
  }
}

