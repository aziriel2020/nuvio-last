#!/usr/bin/env node
// Independent production guard: a running Node process is not proof that
// worldwide live-action series are being discovered for the French market.
const origin = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const MAX_HEARTBEAT_MS = 90 * 60 * 1000;
const MAX_DISCOVERY_MS = 12 * 60 * 60 * 1000;

async function json(pathname) {
  const response = await fetch(origin + pathname, {
    signal: AbortSignal.timeout(20000),
    headers: { accept: 'application/json', 'cache-control': 'no-cache' }
  });
  if (!response.ok) throw new Error(pathname + ' HTTP ' + response.status);
  return response.json();
}
const age = (value) => value ? Date.now() - new Date(value).getTime() : Infinity;
const fail = (message) => { throw new Error('[Series France freshness] ' + message); };

try {
  const [health, status, v2] = await Promise.all([
    json('/_oracle/health'), json('/series/status.json'), json('/series-v2/status.json')
  ]);
  if (!health.ok || health.runtime !== 'oracle-vm') fail('Oracle service unhealthy');
  if (!status.ok || !v2.ok) fail('Series database missing or unreadable');
  if (v2.version !== '2.0.0') fail('Expected Series France V2 addon');
  if (!Number.isFinite(status.eligible) || status.eligible < 1) fail('No live-action titles available in FR');
  if (age(status.lastSync?.at) > MAX_HEARTBEAT_MS) fail('Indexer heartbeat older than 90 minutes');
  if (status.lastSync?.errors?.length) fail('Indexer reports discovery errors: ' + status.lastSync.errors.join(' | '));
  const scan = status.franceScan;
  const latestDiscovery = status.franceLastDiscoveryAt || (scan?.complete ? scan.completedAt : scan?.lastProgressAt);
  if (age(latestDiscovery) > MAX_DISCOVERY_MS) fail('No successful TMDb discovery in over 12 hours');
  if (age(status.franceLastAiringDiscoveryAt) > MAX_DISCOVERY_MS) {
    fail('Recent episode airings have not been discovered in over 12 hours');
  }
  if (scan?.overflow?.length && !scan.tasks?.length) fail('Unresolved provider/date pagination overflow');
  if (status.franceAirScan?.overflow?.length && !status.franceAirScan?.tasks?.length)
    fail('Recent-airing provider/date overflow');
  console.log(JSON.stringify({
    ok: true, at: new Date().toISOString(), eligible: status.eligible,
    latestDiscovery, lastAiringDiscovery: status.franceLastAiringDiscoveryAt,
    indexedAirings: status.indexedAirings, lastSync: status.lastSync?.at,
    scanComplete: Boolean(scan?.complete), pendingTasks: scan?.tasks?.length || 0,
    version: v2.version, deployment: health.gitSha
  }));
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
