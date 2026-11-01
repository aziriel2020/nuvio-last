import { gzip as gzipCallback } from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(gzipCallback);
const MIN_JSON_BYTES = 2048;

function acceptsGzip(value) {
  return String(value || '').split(',').some((entry) => {
    const [name, ...options] = entry.trim().split(';');
    if (name.toLowerCase() !== 'gzip') return false;
    const quality = options.join(';').match(/(?:^|;)\s*q\s*=\s*([0-9.]+)/i);
    return !quality || Number(quality[1]) > 0;
  });
}

function appendVary(current, value) {
  const parts = String(current || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (parts.includes('*') || parts.some((v) => v.toLowerCase() === value.toLowerCase())) return parts.join(', ');
  return [...parts, value].join(', ');
}

// Compress only transport bytes. Content, metadata, catalog IDs, visuals and
// JSON semantics remain unchanged; disk caches retain the uncompressed form.
export async function encodeJsonForClient(body, headers, acceptEncoding = '', method = 'GET') {
  const output = { body, headers: { ...headers } };
  if (!Buffer.isBuffer(body) ||
      !/^application\/json(?:\s*;|$)/i.test(String(headers['content-type'] || '')) ||
      headers['content-encoding'] || body.length < MIN_JSON_BYTES) return output;

  output.headers.vary = appendVary(headers.vary, 'Accept-Encoding');
  if (method !== 'GET' || !acceptsGzip(acceptEncoding)) return output;

  const compressed = await gzip(body, { level: 4 });
  if (compressed.length >= body.length) return output;
  output.body = compressed;
  output.headers['content-encoding'] = 'gzip';
  return output;
}
