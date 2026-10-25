import originals from '../regions/fr/api/original-images.cjs';
export async function relayOriginalImages(request, response) {
  const url = new URL(request.url);
  if (!/^\/(?:movies|series(?:-v2)?|fr|us|tr|global)\/(?:catalog|meta)\//.test(url.pathname)
    || !response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
  const payload = await response.json();
  const body = originals.relayMediaImages(payload, url.origin);
  const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('etag');
  headers.set('X-Nuvio-Original-Images', originals.REVISION);
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}
