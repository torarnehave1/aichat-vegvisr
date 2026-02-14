const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

export const proxyToDomainWorker = async ({ request, env, targetPath }) => {
  if (!env.DOMAIN_WORKER) {
    return jsonResponse(
      {
        success: false,
        message: 'DOMAIN_WORKER service binding is missing.'
      },
      500
    );
  }

  const inboundUrl = new URL(request.url);
  const upstreamUrl = `https://domain-worker${targetPath}${inboundUrl.search}`;
  const upstreamRequest = new Request(upstreamUrl, request);
  return env.DOMAIN_WORKER.fetch(upstreamRequest);
};
