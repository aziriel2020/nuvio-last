import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../runtime/router.mjs';

test('simultaneous Shield poster artwork misses share one render and return independent bodies', async () => {
  let calls = 0;
  const env = { ASSETS: {
    async fetch() {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 35));
      return new Response(Buffer.from('fake-artwork-bytes'), { headers: { 'content-type': 'image/jpeg' } });
    }
  } };
  const url = 'https://nuvio.test/fr/genre-folder-art.svg?genre=action&variant=card&label=ACTION';
  const responses = await Promise.all(Array.from({ length: 14 }, () => router.fetch(new Request(url), env, {})));
  assert.equal(calls, 1, 'only one cold asset load for fourteen identical posters');
  assert(responses.every(r => r.status === 200));
  const bodies = await Promise.all(responses.map(r => r.text()));
  assert(bodies.every(b => b === bodies[0] && b.includes('<svg')));
  assert(responses.some(r => r.headers.get('x-nuvio-cache') === 'COALESCED'));
  await router.fetch(new Request(url), env, {}); // no backing cache: a new independent batch
  assert.equal(calls, 2, 'in-flight task is released when complete');
});

test('failed poster requests are never permanently coalesced', async () => {
  let calls = 0;
  const env = { ASSETS: {
    async fetch() {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 25));
      return calls === 1
        ? new Response('unavailable', { status: 503 })
        : new Response(Buffer.from('fresh-image'), { headers: { 'content-type': 'image/jpeg' } });
    }
  } };
  const url = 'https://nuvio.test/fr/genre-folder-art.svg?genre=drama&variant=card&label=DRAMA';
  const failed = await Promise.all(Array.from({ length: 7 }, () => router.fetch(new Request(url), env, {})));
  assert(failed.every(r => r.status === 503));
  assert.equal(calls, 1);
  const recovered = await router.fetch(new Request(url), env, {});
  assert.equal(recovered.status, 200);
  assert.equal(calls, 2, 'subsequent request retries when source recovers');
});
