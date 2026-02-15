const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

const parseErrorMessage = async (response) => {
  const text = await response.text();
  if (!text) return `Request failed (${response.status})`;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
    if (typeof parsed?.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Ignore JSON parse errors and fall back to plain text
  }
  return text.slice(0, 400);
};

const buildForwardHeaders = (request) => {
  const headers = new Headers();
  const allowedHeaders = ['x-user-role', 'x-user-id', 'x-user-email', 'x-api-token'];
  allowedHeaders.forEach((headerName) => {
    const value = request.headers.get(headerName);
    if (value) headers.set(headerName, value);
  });
  return headers;
};

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return jsonResponse({ success: false, message: 'Method not allowed.' }, 405);
  }

  const knowledgeApiBase = 'https://knowledge.vegvisr.org';
  const pageSize = 250;
  const headers = buildForwardHeaders(context.request);

  try {
    const firstPageUrl = `${knowledgeApiBase}/getknowgraphsummaries?offset=0&limit=${pageSize}`;
    const firstResponse = await fetch(firstPageUrl, { method: 'GET', headers });
    if (!firstResponse.ok) {
      const message = await parseErrorMessage(firstResponse);
      return jsonResponse(
        { success: false, message: `Unable to load graph summaries: ${message}` },
        firstResponse.status
      );
    }

    const firstData = await firstResponse.json().catch(() => ({}));
    const total = Number(firstData?.total || 0);
    const allResults = Array.isArray(firstData?.results) ? [...firstData.results] : [];

    for (let offset = pageSize; offset < total; offset += pageSize) {
      const pageUrl = `${knowledgeApiBase}/getknowgraphsummaries?offset=${offset}&limit=${pageSize}`;
      const pageResponse = await fetch(pageUrl, { method: 'GET', headers });
      if (!pageResponse.ok) {
        const message = await parseErrorMessage(pageResponse);
        return jsonResponse(
          { success: false, message: `Unable to load graph summaries page ${offset}: ${message}` },
          pageResponse.status
        );
      }
      const pageData = await pageResponse.json().catch(() => ({}));
      const pageResults = Array.isArray(pageData?.results) ? pageData.results : [];
      allResults.push(...pageResults);
    }

    const themeGraphs = allResults
      .filter((item) => item?.metadata?.isThemeGraph === true)
      .map((item) => ({
        id: String(item?.id || '').trim(),
        title: String(item?.metadata?.title || item?.title || 'Untitled Theme Graph').trim(),
        updatedAt: String(item?.updatedAt || item?.metadata?.updatedAt || item?.createdAt || ''),
        createdBy: String(item?.metadata?.createdBy || '').trim()
      }))
      .filter((item) => item.id)
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));

    return jsonResponse({
      success: true,
      results: themeGraphs,
      totalThemeGraphs: themeGraphs.length,
      totalGraphs: total
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load theme graphs.'
      },
      500
    );
  }
}
