import originals from '../regions/fr/api/original-images.cjs';
export async function relayOriginalImages(request, response) {
  // Oracle V4 uses native provider URLs directly. Do not route metadata through
  // /images/original.jpg, which re-encodes files with Sharp on every cache miss.
  const url = new URL(request.url);
  // Films Monde is permanently native V4: even a stale Oracle environment
  // must never rewrap TMDB originals into /images/original.jpg (Sharp/JPEG).
  // This covers the canonical addon, including when the Native Bridge is not installed.
  if (url.pathname.startsWith('/movies/') || process.env.NUVIO_V4_NATIVE_ART === '1') return response;
  if (!/^\/(?:movies|series(?:-v2)?|fr|us|tr|global)\/(?:catalog|meta)\//.test(url.pathname)
    || !response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
  const payload = await response.json();
  const body = originals.relayMediaImages(payload, url.origin);
  const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('etag');
  headers.set('X-Nuvio-Original-Images', originals.REVISION);
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}
