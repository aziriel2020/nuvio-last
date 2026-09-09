#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const list = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean);
function integer(value, fallback, min, max) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('Invalid audit limit: ' + value);
  return n;
}
export function config(env = process.env) {
  const mode = env.AUDIT_MODE || 'safe';
  if (!['safe', 'full', 'targeted'].includes(mode)) throw new Error('AUDIT_MODE must be safe, full or targeted');
  return {
    origin: new URL(env.PUBLIC_ORIGIN || 'https://nuvio-last-aziriel2020-1343705637.pages.dev').origin,
    regions: list(env.AUDIT_REGIONS || 'fr,global,tr,us'), mode,
    concurrency: integer(env.AUDIT_CONCURRENCY, 4, 1, 6),
    attempts: integer(env.AUDIT_ATTEMPTS, 3, 1, 5),
    timeout: integer(env.AUDIT_TIMEOUT_MS, 25000, 100, 120000),
    interval: integer(env.AUDIT_INTERVAL_MS, 100, 0, 10000),
    budget: integer(env.AUDIT_REQUEST_BUDGET, mode === 'full' ? 60000 : 6000, 1, 90000),
    metaSamples: integer(env.AUDIT_META_SAMPLES, 2, 0, 5),
    providers: list(env.AUDIT_PROVIDERS || env.AUDIT_FAMILIES),
    years: list(env.AUDIT_YEARS), ids: list(env.AUDIT_IDS),
    failures: env.AUDIT_FAILURES || '', report: env.AUDIT_REPORT || 'audit-report.json',
    cards: integer(env.AUDIT_DESKTOP_CARDS, 12, 0, 40),
    design: env.AUDIT_DESIGN || 'shield3',
    strict: !['0', 'false', 'no'].includes(String(env.AUDIT_STRICT || '1').toLowerCase())
  };
}
export function family(id) {
  return String(id).replace(/-(today|tomorrow|yesterday|lastweek|nextweek|past7|next7|week|month|lastmonth|nowplaying)$/i, '').replace(/-\d{4}-\d{2}$/, '');
}
export function shape(meta, expectedType) {
  const errors = [];
  if (!meta || typeof meta !== 'object') return ['not object'];
  if (typeof meta.id !== 'string' || !meta.id.trim()) errors.push('id');
  if (!['movie', 'series'].includes(meta.type) || (expectedType && expectedType !== meta.type)) errors.push('type');
  if (typeof meta.name !== 'string' || !meta.name.trim()) errors.push('name');
  for (const key of ['poster', 'background', 'landscapePoster', 'banner']) {
    if (key !== 'poster' && !meta[key]) continue;
    try { if (!/^https?:$/.test(new URL(meta[key]).protocol)) errors.push(key); } catch { errors.push(key); }
  }
  return errors;
}
export function classify(status, body, headers = new Headers()) {
  if (/1102|Worker exceeded resource limits/i.test(body)) return 'worker-resource';
  if (status === 429 || /1027/.test(body)) return 'quota-or-rate-limit';
  if (status >= 500 || headers.get('x-nuvio-upstream-error') === '1') return 'upstream-5xx';
  if (status >= 400) return 'http-error';
  if (!headers.get('content-type')?.includes('json') && /^\s*<!doctype|^\s*<html/i.test(body)) return 'runtime-unavailable';
  return 'malformed-metadata';
}
class AuditError extends Error {
  constructor(message, category, history = []) { super(message); this.category = category; this.history = history; }
}
export function createClient(cfg, fetcher = fetch) {
  let active = 0, nextStart = 0, requests = 0, stopped = null;
  const queue = [], failures = [];
  async function acquire() {
    if (stopped) throw stopped;
    if (active >= cfg.concurrency) await new Promise(resolve => queue.push(resolve));
    else active++;
    const delay = Math.max(0, nextStart - Date.now());
    nextStart = Math.max(nextStart, Date.now()) + cfg.interval;
    if (delay) await sleep(delay);
  }
  function release() { if (queue.length) queue.shift()(); else active--; }
  async function get(route, { native = true, json = true, attempts = cfg.attempts } = {}) {
    const url = new URL(route, cfg.origin);
    if (url.origin !== cfg.origin) throw new AuditError('Audit URL escaped configured origin', 'invalid-origin');
    const history = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await acquire();
      let timer;
      try {
        if (stopped) throw stopped;
        if (++requests > cfg.budget) throw (stopped = new AuditError('Request budget reached; remaining routes were not tested', 'budget-exhausted'));
        const ac = new AbortController();
        timer = setTimeout(() => ac.abort(), cfg.timeout);
        const start = Date.now();
        const response = await fetcher(url, { redirect: 'error', signal: ac.signal, headers: {
          accept: json ? 'application/json' : 'image/svg+xml,image/*;q=.9,*/*;q=.8',
          'user-agent': 'NuvioCatalogAudit/2.0',
          'x-nuvio-timezone': 'Europe/Brussels'
        } });
        const body = await response.text();
        const item = { status: response.status, ms: Date.now() - start, ray: response.headers.get('cf-ray') };
        history.push(item);
        const category = classify(response.status, body, response.headers);
        if (category === 'runtime-unavailable' || (native && response.ok && response.headers.get('x-nuvio-origin') !== 'cloudflare-only')) {
          throw (stopped = new AuditError('Dynamic runtime unavailable: ' + url.pathname + ' returned ' + response.headers.get('content-type') + ' without native headers', 'runtime-unavailable', history));
        }
        if (!response.ok || response.headers.get('x-nuvio-upstream-error') === '1') {
          item.category = category;
          throw new AuditError('HTTP ' + response.status + ': ' + body.replace(/\s+/g, ' ').slice(0, 350), category, history);
        }
        let data;
        if (json) {
          try { data = JSON.parse(body); } catch { throw new AuditError('Invalid JSON: ' + url.pathname, 'malformed-metadata', history); }
        }
        return { data, body, headers: response.headers, history, ms: item.ms };
      } catch (error) {
        const e = error instanceof AuditError ? error : new AuditError(error.message, 'network-or-timeout', history);
        if (!history.length || history.at(-1).category == null) history.push({ category: e.category, error: e.message });
        if (stopped || attempt === attempts || !['worker-resource', 'upstream-5xx', 'quota-or-rate-limit', 'network-or-timeout'].includes(e.category)) {
          e.history = history;
          failures.push({ path: url.pathname, category: e.category, history });
          throw e;
        }
      } finally { clearTimeout(timer); release(); }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    }
  }
  return { get, get requests() { return requests; }, get stopped() { return stopped; }, failures };
}
function collect(value, map, region) {
  if (!value || typeof value !== 'object') return;
  if (['movie', 'series'].includes(value.type) && typeof value.catalogId === 'string') {
    const key = value.type + ':' + value.catalogId;
    map.set(key, { ...map.get(key), region, type: value.type, id: value.catalogId, collection: true });
  }
  for (const child of Object.values(value)) if (typeof child === 'object') collect(child, map, region);
}
export async function discover(client, region) {
  const mf = await client.get('/' + region + '/manifest.json', { native: false });
  const co = await client.get('/' + region + '/nuvio-collections.json', { native: false });
  if (!Array.isArray(mf.data?.catalogs)) throw new Error(region + ' manifest catalogs missing');
  const map = new Map();
  for (const c of mf.data.catalogs) if (['movie', 'series'].includes(c.type) && c.id) {
    map.set(c.type + ':' + c.id, { region, type: c.type, id: c.id, manifest: true });
  }
  collect(co.data, map, region);
  return [...map.values()].map(c => ({ ...c, family: family(c.id), path: '/' + region + '/catalog/' + c.type + '/' + encodeURIComponent(c.id) + '.json' }));
}
export function select(catalogs, cfg, prior = [], now = new Date()) {
  const replay = new Set(prior.filter(r => r.status === 'FAIL' || r.status === 'NOT_TESTED').map(r => r.region + ':' + r.type + ':' + r.id));
  const months = [now, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))].map(d => d.toISOString().slice(0, 7));
  return catalogs.filter(c => {
    if (cfg.failures && !replay.has(c.region + ':' + c.type + ':' + c.id)) return false;
    if (cfg.providers.length && !cfg.providers.some(p => c.family === p || c.family.endsWith('-' + p))) return false;
    if (cfg.years.length && !cfg.years.some(y => c.id.match(/-(\d{4})-\d{2}$/)?.[1] === y)) return false;
    if (cfg.ids.length && !cfg.ids.includes(c.id)) return false;
    if (cfg.mode !== 'safe' || cfg.failures || cfg.years.length || cfg.ids.length) return true;
    return !/-\d{4}-\d{2}$/.test(c.id) || months.some(m => c.id.endsWith('-' + m));
  });
}
async function pool(items, count, fn) {
  let cursor = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    for (;;) { const index = cursor++; if (index >= items.length) break; out[index] = await fn(items[index]); }
  }));
  return out;
}
export function summarize(results, inventory) {
  const groups = new Map(), byRegion = {};
  for (const r of inventory) {
    const k = r.region + ':' + r.type + ':' + r.family;
    if (!groups.has(k)) groups.set(k, { total: 0, results: [] });
    groups.get(k).total++;
  }
  for (const r of results) groups.get(r.region + ':' + r.type + ':' + r.family)?.results.push(r);
  const families = [...groups].filter(([, v]) => v.results.length).map(([key, v]) => ({
    key, discovered: v.total, tested: v.results.filter(r => r.status !== 'NOT_TESTED').length,
    complete: v.results.length === v.total && v.results.every(r => !['FAIL', 'NOT_TESTED'].includes(r.status)),
    allEmpty: v.results.every(r => r.status === 'EMPTY'),
    nonEmpty: v.results.filter(r => r.status === 'OK').length,
    failures: v.results.filter(r => r.status === 'FAIL').length
  }));
  for (const region of new Set(inventory.map(c => c.region))) {
    const rr = results.filter(r => r.region === region);
    byRegion[region] = {
      discovered: inventory.filter(c => c.region === region).length,
      selected: rr.length, tested: rr.filter(r => r.status !== 'NOT_TESTED').length,
      nonEmpty: rr.filter(r => r.status === 'OK').length,
      empty: rr.filter(r => r.status === 'EMPTY').length,
      legitimateEmpty: rr.filter(r => r.status === 'EMPTY' && r.emptyReason).length,
      failures: rr.filter(r => r.status === 'FAIL').length,
      transient: rr.filter(r => r.recovered).length
    };
  }
  return { discovered: inventory.length, selected: results.length, tested: results.filter(r => r.status !== 'NOT_TESTED').length, byRegion, families };
}
export async function run(cfg, fetcher = fetch) {
  const client = createClient(cfg, fetcher), inventory = [], results = [], cards = [], metas = new Map();
  const report = { schemaVersion: 2, startedAt: new Date().toISOString(), config: cfg, inventory, results, cards };
  let fatal;
  try {
    for (const r of cfg.regions) inventory.push(...await discover(client, r));
    console.log('[DISCOVER] ' + inventory.length + ' catalogs');
    const prior = cfg.failures ? JSON.parse(fs.readFileSync(cfg.failures, 'utf8')) : {};
    const selected = select(inventory, cfg, Array.isArray(prior) ? prior : prior.results || []);
    if (!selected.length) throw new Error('No catalog matches filters');
    await client.get('/health', { attempts: 1 });
    const cardCandidates = [];
    const checkMeta = async (region, m) => {
      const key = region + ':' + m.type + ':' + m.id;
      if (metas.has(key)) return metas.get(key);
      const p = (async () => {
        const response = await client.get('/' + region + '/meta/' + m.type + '/' + encodeURIComponent(m.id) + '.json');
        if (response.data?.meta?.id !== m.id || shape(response.data.meta, m.type).length) throw new AuditError('Unresolved or malformed meta ' + m.id, 'malformed-metadata');
        return response.history;
      })();
      metas.set(key, p);
      try { return await p; } catch (e) { metas.delete(key); throw e; }
    };
    const audited = await pool(selected, cfg.concurrency, async c => {
      if (client.stopped) return { ...c, status: 'NOT_TESTED', category: client.stopped.category };
      try {
        const response = await client.get(c.path);
        const data = response.data;
        if (!Array.isArray(data?.metas)) throw new AuditError('metas[] missing', 'malformed-metadata');
        if (Number(response.headers.get('x-nuvio-calendar-source-errors')) > 0) throw new AuditError('Source errors reported by catalog', 'upstream-5xx');
        for (const m of data.metas) {
          const errors = shape(m, c.type);
          if (errors.length) throw new AuditError('Bad meta ' + m?.id + ': ' + errors.join(', '), 'malformed-metadata');
          if (/vercel\.app/i.test(JSON.stringify(m))) throw new AuditError('Metadata references a non-Cloudflare application URL', 'invalid-origin');
        }
        const histories = [...response.history];
        for (const m of data.metas.slice(0, cfg.metaSamples)) histories.push(...await checkMeta(c.region, m));
        for (const m of data.metas.slice(0, 5)) if (m.banner?.includes('/desktop-content-card.jpg')) cardCandidates.push({ region: c.region, name: m.name, type: m.type, url: m.banner });
        return { ...c, status: data.metas.length ? 'OK' : 'EMPTY', count: data.metas.length, emptyReason: response.headers.get('x-nuvio-empty-reason'), source: response.headers.get('x-nuvio-anime-source'), recovered: histories.some(h => h.category), history: response.history };
      } catch (e) {
        console.error('[FAIL] ' + c.region + ' ' + c.id + ' ' + (e.category || e.message));
        return { ...c, status: client.stopped ? 'NOT_TESTED' : 'FAIL', error: e.message, category: e.category || 'malformed-metadata', history: e.history || [] };
      }
    });
    results.push(...audited);
    for (const row of results.filter(r => r.category === 'worker-resource')) {
      try {
        await client.get(row.path, { attempts: 2 });
        row.category = 'resource-recovered-needs-revalidation';
      } catch (e) {
        row.confirmation = e.history;
        if (e.category === 'worker-resource' && e.history.filter(h => h.category === 'worker-resource').length >= 2) row.category = 'worker-resource-reproducible';
      }
    }
    const chosen = [], seen = new Set();
    for (let i = 0; i < cfg.cards; i++) {
      const region = cfg.regions[i % cfg.regions.length];
      const c = cardCandidates.find(c => c.region === region && !seen.has(c.region + ':' + c.name)) || cardCandidates.find(c => !seen.has(c.region + ':' + c.name));
      if (!c) break;
      seen.add(c.region + ':' + c.name); chosen.push(c);
    }
    for (const c of chosen) {
      try {
        const u = new URL(c.url);
        if (!/desktop11$/.test(u.searchParams.get('v') || '')) throw new Error('desktop11 missing');
        if (cfg.design === 'shield3' && u.searchParams.get('design') !== 'shield3') throw new Error('shield3 missing');
        const response = await client.get(u, { json: false });
        if (response.headers.get('x-nuvio-card-renderer') !== 'calendar-overlay-v2') throw new Error('Legacy card renderer changed');
        if (cfg.design === 'shield3') for (const token of ['data-renderer="shield-desktop-v3"', 'desktop-title', 'desktop-subtitle', 'desktop-provider']) if (!response.body.includes(token)) throw new Error('SVG missing ' + token);
        if (!/<image[^>]+href="data:image\/(jpeg|png|webp);base64,/.test(response.body)) throw new Error('No embedded real background');
        cards.push({ ...c, status: 'OK', bytes: response.body.length, logo: response.headers.get('x-nuvio-provider-logo') });
        const dir = path.join(path.dirname(cfg.report), 'desktop-cards');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, c.region + '-' + cards.length + '.svg'), response.body);
      } catch (e) { cards.push({ ...c, status: 'FAIL', error: e.message }); }
    }
    if (client.stopped) fatal = client.stopped.message;
  } catch (e) { fatal = e.message; }
  Object.assign(report, { finishedAt: new Date().toISOString(), summary: summarize(results, inventory), requests: client.requests, metaRoutes: metas.size, fatal });
  fs.mkdirSync(path.dirname(cfg.report), { recursive: true });
  fs.writeFileSync(cfg.report, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report.summary, families: undefined, requests: report.requests, desktop: cards, fatal }, null, 2));
  const uncertainEmpty = report.summary.families.some(f => f.complete && f.allEmpty && f.discovered >= 6);
  return { report, failed: Boolean(fatal || results.some(r => ['FAIL', 'NOT_TESTED'].includes(r.status)) || cards.some(c => c.status === 'FAIL') || (cfg.cards && cards.length < cfg.cards) || uncertainEmpty) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = config();
  run(cfg).then(({ failed }) => { if (failed && cfg.strict) process.exitCode = 1; }).catch(e => { console.error(e); process.exitCode = 1; });
}
