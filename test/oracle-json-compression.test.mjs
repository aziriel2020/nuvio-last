import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { encodeJsonForClient } from '../oracle/response-compression.mjs';

const json = Buffer.from(JSON.stringify({
  catalogs: Array.from({ length: 1000 }, (_, i) => ({
    id: 'movies-fr-all-28-2026-10-' + i, type: 'movie',
    name: 'Films Monde, calendrier premium de France', showInHome: false
  }))
}));
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

test('large canonical manifest/catalog JSON compresses without altering content or cache policy', async () => {
  const encoded = await encodeJsonForClient(json, headers, 'br, gzip, deflate');
  assert.equal(encoded.headers['content-encoding'], 'gzip');
  assert.match(encoded.headers.vary, /Accept-Encoding/);
  assert.equal(encoded.headers['cache-control'], 'no-store');
  assert(encoded.body.length < json.length / 3);
  assert(gunzipSync(encoded.body).equals(json), 'same original JSON bytes after decoding');
  assert.equal(headers['content-encoding'], undefined, 'original headers remain unchanged');
});

test('gzip negotiation obeys q=0 and preserves identity fallback', async () => {
  for (const accept of ['', 'br', 'gzip;q=0', 'gzip;q=0.0, deflate', 'gzip;q=0, br;q=1']) {
    const encoded = await encodeJsonForClient(json, headers, accept);
    assert.equal(encoded.headers['content-encoding'], undefined);
    assert(encoded.body.equals(json));
  }
  const allowed = await encodeJsonForClient(json, headers, 'br, gzip;q=0.5');
  assert.equal(allowed.headers['content-encoding'], 'gzip');
});

test('small JSON, images and HEAD requests are never compressed', async () => {
  const small = Buffer.from('{"metas":[]}');
  const smallResult = await encodeJsonForClient(small, headers, 'gzip');
  assert.deepEqual(smallResult.body, small);
  assert.equal(smallResult.headers['content-encoding'], undefined);

  const image = await encodeJsonForClient(json, { 'content-type': 'image/jpeg' }, 'gzip');
  assert.equal(image.headers['content-encoding'], undefined);
  assert(image.body.equals(json));

  const head = await encodeJsonForClient(json, headers, 'gzip', 'HEAD');
  assert.equal(head.headers['content-encoding'], undefined);
});

test('Vary preserves existing tokens without duplicates', async () => {
  const result = await encodeJsonForClient(json, {
    ...headers, vary: 'Origin, Accept-Encoding'
  }, 'gzip');
  assert.equal(result.headers.vary, 'Origin, Accept-Encoding');
});
