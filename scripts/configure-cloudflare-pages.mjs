#!/usr/bin/env node
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const project = process.env.CLOUDFLARE_PROJECT_NAME;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !project || !token) throw new Error('Cloudflare Pages configuration credentials are missing.');

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
    throw new Error('Cloudflare Pages project update failed: HTTP ' + response.status + ' codes=' + JSON.stringify(payload?.errors?.map(e => e.code)));
  }
  return payload.result;
}

const before = await request('GET');
const current = before?.deployment_configs?.production?.fail_open;
console.log('Cloudflare production fail_open before:', current);
if (current !== false) {
  await request('PATCH', {
    deployment_configs: {
      production: {
        fail_open: false
      }
    }
  });
}
const after = await request('GET');
if (after?.deployment_configs?.production?.fail_open !== false) {
  throw new Error('Cloudflare production fail_open is still enabled.');
}
console.log('Cloudflare production fail_open verified: false');
