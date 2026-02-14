const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

const OWNER_PREFIX = 'theme:owner:';
const SHARED_PREFIX = 'theme:shared:';

const normalizeId = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const isThemeShapeValid = (theme) => {
  if (!theme || typeof theme !== 'object') return false;
  if (!theme.id || !theme.label || !theme.tokens) return false;
  if (!Array.isArray(theme.tags) || !Array.isArray(theme.swatches)) return false;
  return true;
};

const listKvByPrefix = async (kv, prefix) => {
  const results = [];
  let cursor = undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 100 });
    if (Array.isArray(page.keys)) {
      results.push(...page.keys.map((item) => item.name));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return results;
};

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const kv = env.THEME_STUDIO_KV;

  if (!kv) {
    return jsonResponse(
      {
        success: false,
        message: 'THEME_STUDIO_KV binding is missing.'
      },
      500
    );
  }

  const userId = String(request.headers.get('x-user-id') || '').trim();
  const userEmail = String(request.headers.get('x-user-email') || '').trim();

  if (!userId) {
    return jsonResponse(
      {
        success: false,
        message: 'Missing x-user-id header.'
      },
      401
    );
  }

  if (method === 'GET') {
    const ownPrefix = `${OWNER_PREFIX}${userId}:`;
    const ownKeys = await listKvByPrefix(kv, ownPrefix);
    const sharedKeys = await listKvByPrefix(kv, SHARED_PREFIX);
    const byCompositeId = new Map();

    const allKeys = [...ownKeys, ...sharedKeys];
    for (const key of allKeys) {
      const raw = await kv.get(key);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw);
        const theme = record.theme;
        if (!isThemeShapeValid(theme)) continue;
        const owner = String(record.ownerUserId || 'unknown');
        const composite = `${owner}:${theme.id}`;
        byCompositeId.set(composite, record);
      } catch {
        // Ignore malformed records.
      }
    }

    const records = [...byCompositeId.values()]
      .filter((record) => {
        if (record.ownerUserId === userId) return true;
        return record.visibility === 'shared';
      })
      .sort((a, b) => {
        const aTs = Date.parse(a.updatedAt || a.createdAt || '') || 0;
        const bTs = Date.parse(b.updatedAt || b.createdAt || '') || 0;
        return bTs - aTs;
      });

    const themes = records.map((record) => ({
      ...record.theme,
      ownerUserId: record.ownerUserId,
      ownerEmail: record.ownerEmail || null,
      visibility: record.visibility || 'shared',
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null
    }));

    return jsonResponse({ success: true, themes });
  }

  if (method === 'POST') {
    const body = await readJson(request);
    const theme = body?.theme;
    const visibility = body?.visibility === 'private' ? 'private' : 'shared';

    if (!isThemeShapeValid(theme)) {
      return jsonResponse(
        {
          success: false,
          message: 'Invalid theme payload.'
        },
        400
      );
    }

    const themeId = normalizeId(theme.id);
    if (!themeId) {
      return jsonResponse(
        {
          success: false,
          message: 'Invalid theme id.'
        },
        400
      );
    }

    const now = new Date().toISOString();
    const ownerKey = `${OWNER_PREFIX}${userId}:${themeId}`;
    const sharedKey = `${SHARED_PREFIX}${themeId}:${userId}`;
    const normalizedTheme = {
      ...theme,
      id: themeId
    };
    const record = {
      theme: normalizedTheme,
      ownerUserId: userId,
      ownerEmail: userEmail || null,
      visibility,
      createdAt: now,
      updatedAt: now
    };

    const existingRaw = await kv.get(ownerKey);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        if (existing?.createdAt) {
          record.createdAt = existing.createdAt;
        }
      } catch {
        // Keep generated createdAt on parse errors.
      }
    }

    await kv.put(ownerKey, JSON.stringify(record));
    if (visibility === 'shared') {
      await kv.put(sharedKey, JSON.stringify(record));
    } else {
      await kv.delete(sharedKey);
    }

    return jsonResponse({
      success: true,
      theme: {
        ...normalizedTheme,
        ownerUserId: userId,
        ownerEmail: userEmail || null,
        visibility,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }
    });
  }

  if (method === 'DELETE') {
    const url = new URL(request.url);
    const themeId = normalizeId(url.searchParams.get('themeId') || '');
    if (!themeId) {
      return jsonResponse(
        {
          success: false,
          message: 'themeId query param is required.'
        },
        400
      );
    }

    const ownerKey = `${OWNER_PREFIX}${userId}:${themeId}`;
    const sharedKey = `${SHARED_PREFIX}${themeId}:${userId}`;
    await kv.delete(ownerKey);
    await kv.delete(sharedKey);

    return jsonResponse({ success: true, removed: true, themeId });
  }

  return jsonResponse(
    {
      success: false,
      message: 'Method not allowed.'
    },
    405
  );
}
