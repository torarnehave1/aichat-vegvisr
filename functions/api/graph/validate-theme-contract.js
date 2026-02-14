import { proxyToDomainWorker } from '../_utils/domainWorkerProxy.js';

export async function onRequest(context) {
  return proxyToDomainWorker({
    request: context.request,
    env: context.env,
    targetPath: '/graph/validate-theme-contract'
  });
}
