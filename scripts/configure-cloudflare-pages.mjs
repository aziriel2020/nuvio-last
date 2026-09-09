#!/usr/bin/env node
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const project = process.env.CLOUDFLARE_PROJECT_NAME;
const token = process.env.CLOUDFLARE_API_TOKEN;
const productionBranch = process.env.CLOUDFLARE_PRODUCTION_BRANCH || 'main';

if (!account || !project || !token) {
  throw new Error('Cloudflare Pages configuration credentials are missing.');
}

const base = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/pages/projects/' + project;

async function request(method, body) {
  const response = await fetch(base, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    const details = JSON.stringify(payload?.errors || payload || {});
    throw new Error(
      'Cloudflare Pages project update failed: HTTP ' +
      response.status +
      ' details=' +
      details.slice(0, 1200)
    );
  }
  return payload.result;
}

const before = await request('GET');
console.log('Cloudflare production branch before:', before?.production_branch || '<unset>');
console.log('Cloudflare production fail_open before:', before?.deployment_configs?.production?.fail_open);
console.log('Cloudflare preview fail_open before:', before?.deployment_configs?.preview?.fail_open);

if (before?.production_branch !== productionBranch) {
  await request('PATCH', { production_branch: productionBranch });
}

if (
  before?.deployment_configs?.production?.fail_open !== false ||
  before?.deployment_configs?.preview?.fail_open !== false
) {
  await request('PATCH', {
    deployment_configs: {
      production: { fail_open: false },
      preview: { fail_open: false }
    }
  });
}

const after = await request('GET');
if (after?.production_branch !== productionBranch) {
  throw new Error(
    'Cloudflare production branch mismatch after update: ' +
    String(after?.production_branch || '<unset>')
  );
}
if (after?.deployment_configs?.production?.fail_open !== false) {
  throw new Error('Cloudflare production fail_open is not false after update');
}
if (after?.deployment_configs?.preview?.fail_open !== false) {
  throw new Error('Cloudflare preview fail_open is not false after update');
}

console.log('Cloudflare production branch verified:', after.production_branch);
console.log('Cloudflare production fail_open verified: false');
console.log('Cloudflare preview fail_open verified: false');
console.log(
  'Cloudflare production environment vars:',
  Object.keys(after?.deployment_configs?.production?.env_vars || {}).sort().join(',') || '<none>'
);
