import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { V2_ADDON_ID, V2_VERSION } = createRequire(import.meta.url)('../regions/series/src/model.cjs');

function probe({ version = V2_VERSION, addonId = V2_ADDON_ID, stale = false } = {}) {
  const now = new Date().toISOString();
  const status = { ok:true, eligible:42, lastSync:{at:stale ? '2000-01-01T00:00:00Z' : now, errors:[]},
    franceLastDiscoveryAt:now, franceLastAiringDiscoveryAt:now, franceScan:{complete:true,tasks:[],overflow:[]},
    franceAirScan:{complete:true,tasks:[],overflow:[]},indexedAirings:12 };
  const fixtures = { '/_oracle/health':{ok:true,runtime:'oracle-vm',gitSha:'fixture'},
    '/series/status.json':status,'/series-v2/status.json':{...status,version,addonId} };
  const mock = `const fixtures=${JSON.stringify(fixtures)};globalThis.fetch=async input=>{const data=fixtures[new URL(input).pathname];if(!data)throw Error('Unexpected URL');return new Response(JSON.stringify(data),{status:200});};`;
  return spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(mock),'scripts/check-series-freshness.mjs'],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,PUBLIC_ORIGIN:'https://freshness.example'}});
}

test('freshness monitor accepts the current deployed Series V2 release', () => {
  const result = probe(); assert.equal(result.status,0,result.stderr);
  const output = JSON.parse(result.stdout); assert.equal(output.ok,true);assert.equal(output.version,V2_VERSION);
});
test('freshness monitor rejects an obsolete addon version', () => {
  const result = probe({version:'2.0.0'});assert.equal(result.status,1);assert.match(result.stderr,/Expected Series France V2 addon/);
});
test('freshness monitor rejects the wrong addon identity', () => {
  const result = probe({addonId:'com.nuvio.series.world.liveaction'});assert.equal(result.status,1);assert.match(result.stderr,/Expected Series France V2 addon/);
});
test('freshness monitor still detects a stale indexer heartbeat', () => {
  const result = probe({stale:true});assert.equal(result.status,1);assert.match(result.stderr,/heartbeat older than 90 minutes/);
});
