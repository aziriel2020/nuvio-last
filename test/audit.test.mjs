import test from 'node:test';
import assert from 'node:assert/strict';
import { config, createClient, family, select, shape, summarize } from '../scripts/audit-production-catalogs.mjs';

const native = { 'content-type': 'application/json', 'x-nuvio-origin': 'cloudflare-only' };
test('audit stops on fail-open HTML without retrying every catalog', async () => {
  let calls = 0;
  const client = createClient(config({ AUDIT_INTERVAL_MS: '0' }), async () => { calls++; return new Response('<!doctype html><h1>home</h1>', { headers: { 'content-type': 'text/html' } }); });
  await assert.rejects(client.get('/health'), /Dynamic runtime unavailable/);
  await assert.rejects(client.get('/fr/catalog/x.json'), /Dynamic runtime unavailable/);
  assert.equal(calls, 1);
});
test('concurrency applies to every outbound request and response consumption', async () => {
  let active = 0, maximum = 0;
  const client = createClient(config({ AUDIT_INTERVAL_MS: '0', AUDIT_CONCURRENCY: '2' }), async () => {
    active++; maximum = Math.max(maximum, active);
    return { ok: true, status: 200, headers: new Headers(native), text: async () => {
      await new Promise(r => setTimeout(r, 10)); active--; return '{}';
    } };
  });
  await Promise.all(Array.from({ length: 20 }, () => client.get('/health')));
  assert.equal(maximum, 2);
});
test('request budget stops before sending the next request', async () => {
  let calls = 0;
  const client = createClient(config({ AUDIT_INTERVAL_MS: '0', AUDIT_REQUEST_BUDGET: '1' }), async () => { calls++; return new Response('{}', { headers: native }); });
  await client.get('/health');
  await assert.rejects(client.get('/health'), /budget/);
  assert.equal(calls, 1);
});
test('retry evidence distinguishes recovered Worker errors', async () => {
  let calls = 0;
  const client = createClient(config({ AUDIT_INTERVAL_MS: '0' }), async () => ++calls === 1 ? new Response('Error 1102', { status: 503 }) : new Response('{}', { headers: native }));
  const result = await client.get('/health');
  assert.equal(calls, 2);
  assert.equal(result.history[0].category, 'worker-resource');
});
test('family discovery does not call an incomplete or failed family systemically empty', () => {
  const inventory = ['2026-08', '2025-01'].map(m => ({ region: 'global', type: 'series', id: 'archives-global-v1-series-anime-asia-' + m, family: 'archives-global-v1-series-anime-asia' }));
  const summary = summarize([{ ...inventory[0], status: 'EMPTY' }, { ...inventory[1], status: 'FAIL' }], inventory);
  assert.equal(summary.families[0].complete, false);
  assert.equal(summary.families[0].allEmpty, false);
  const cfg = config({ AUDIT_MODE: 'targeted', AUDIT_PROVIDERS: 'anime-asia', AUDIT_YEARS: '2025', AUDIT_FAILURES: 'previous.json' });
  assert.deepEqual(select(inventory, cfg, [{ ...inventory[1], status: 'FAIL' }]), [inventory[1]]);
  assert.equal(family(inventory[0].id), inventory[0].family);
});
test('all metadata requires a usable poster and matching media type', () => {
  assert.deepEqual(shape({ id: 'tt1', name: 'Title', type: 'series', poster: null }, 'series'), ['poster']);
  assert.deepEqual(shape({ id: 'tt1', name: 'Title', type: 'movie', poster: 'https://example.com/a.jpg' }, 'series'), ['type']);
  assert.throws(() => config({ AUDIT_CONCURRENCY: '24' }), /Invalid audit limit/);
});
