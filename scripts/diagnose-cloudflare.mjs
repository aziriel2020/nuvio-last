// Read-only diagnosis: never log credentials or environment values.
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const project = process.env.CLOUDFLARE_PROJECT_NAME;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) { console.log('Cloudflare account diagnostics unavailable: no deployment credential.'); process.exit(0); }
async function read(route) {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + route, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(20000)
  });
  const j = await r.json();
  if (!r.ok || !j.success) { console.log('Diagnostic ' + route + ': HTTP ' + r.status + ' codes=' + JSON.stringify(j.errors?.map(e => e.code))); return null; }
  return j.result;
}
const settings = await read('/workers/account-settings');
if (settings) console.log('WORKERS_SETTINGS ' + JSON.stringify({ default_usage_model: settings.default_usage_model, usage_model: settings.usage_model }));
const p = await read('/pages/projects/' + project);
if (p) console.log('PAGES_PROJECT ' + JSON.stringify({
  name: p.name, production_branch: p.production_branch,
  production: { compatibility_date: p.deployment_configs?.production?.compatibility_date, compatibility_flags: p.deployment_configs?.production?.compatibility_flags, usage_model: p.deployment_configs?.production?.usage_model, fail_open: p.deployment_configs?.production?.fail_open },
  latest: { id: p.latest_deployment?.id, url: p.latest_deployment?.url, stage: p.latest_deployment?.latest_stage, uses_functions: p.latest_deployment?.uses_functions },
  canonical: { id: p.canonical_deployment?.id, url: p.canonical_deployment?.url, uses_functions: p.canonical_deployment?.uses_functions }
}));
const date = new Date().toISOString().slice(0, 10);
const query = 'query($account: String!, $start: Time!) { viewer { accounts(filter: { accountTag: $account }) { pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $start }) { sum { requests errors } } } } }';
const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { account, start: date + 'T00:00:00Z' } }), signal: AbortSignal.timeout(20000)
});
console.log('WORKERS_TODAY ' + JSON.stringify(await r.json()));
// A plain-text TMDb binding may be returned by Pages. Encrypted values are never
// exported; when unavailable, the provider diagnosis stays explicitly pending.
const vars = p?.deployment_configs?.production?.env_vars || {};
const tmdbToken = process.env.TMDB_READ_TOKEN || (vars.TMDB_READ_TOKEN?.type === 'plain_text' ? vars.TMDB_READ_TOKEN.value : '');
const tmdbKey = process.env.TMDB_API_KEY || (vars.TMDB_API_KEY?.type === 'plain_text' ? vars.TMDB_API_KEY.value : '');
if (tmdbToken || tmdbKey) {
  const { default: providers } = await import('../shared/providers-tr.cjs');
  const normalize = name => String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const type of ['movie', 'tv']) {
    const url = new URL('https://api.themoviedb.org/3/watch/providers/' + type);
    url.searchParams.set('watch_region', 'TR');
    if (!tmdbToken) url.searchParams.set('api_key', tmdbKey);
    const response = await fetch(url, { headers: tmdbToken ? { Authorization: 'Bearer ' + tmdbToken } : {}, signal: AbortSignal.timeout(20000) });
    if (!response.ok) { console.log('TR_PROVIDER_DIRECTORY ' + type + ' HTTP ' + response.status); continue; }
    const directory = (await response.json()).results || [];
    for (const provider of providers) {
      const aliases = provider.aliases.map(normalize);
      const prefixes = (provider.matchPrefixes || []).map(normalize);
      const matches = directory.filter(p => aliases.includes(normalize(p.provider_name)) || prefixes.some(pre => normalize(p.provider_name) === pre || normalize(p.provider_name).startsWith(pre + ' ')));
      console.log('TR_PROVIDER ' + JSON.stringify({ type, slug: provider.slug, matches: matches.map(p => ({ id: p.provider_id, name: p.provider_name })) }));
    }
  }
} else console.log('TR_PROVIDER_DIRECTORY pending: TMDb binding is encrypted and no GitHub TMDb secret is available.');
