#!/usr/bin/env node
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const project = process.env.CLOUDFLARE_PROJECT_NAME;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !project || !token) throw new Error('Cloudflare Pages configuration credentials are missing.');

const base = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/pages/projects/' + project;

async function call(method, body) {
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
  return {
    ok: Boolean(response.ok && payload?.success),
    status: response.status,
    result: payload?.result || null,
    errors: payload?.errors || []
  };
}

const beforeResponse = await call('GET');
if (!beforeResponse.ok) {
  throw new Error('Cloudflare Pages project read failed: HTTP ' + beforeResponse.status);
}
const before = beforeResponse.result;
const current = before?.deployment_configs?.production?.fail_open;
console.log('Cloudflare production fail_open before:', current);

if (current === false) {
  console.log('Cloudflare production fail_open already verified: false');
  process.exit(0);
}

const patch = await call('PATCH', {
  deployment_configs: {
    production: {
      fail_open: false
    }
  }
});

if (!patch.ok) {
  const diagnostics = patch.errors.map(error => ({
    code: error?.code,
    message: error?.message
  }));
  console.warn(
    'Cloudflare fail_open tuning is unsupported by this project/API configuration; deployment will continue. ' +
    'HTTP ' + patch.status + ' errors=' + JSON.stringify(diagnostics)
  );
  process.exit(0);
}

const afterResponse = await call('GET');
if (!afterResponse.ok) {
  console.warn('Cloudflare fail_open was patched but verification GET failed; deployment will continue.');
  process.exit(0);
}

const after = afterResponse.result?.deployment_configs?.production?.fail_open;
if (after !== false) {
  console.warn('Cloudflare production fail_open remains enabled; bounded runtime caches remain the primary protection.');
  process.exit(0);
}
console.log('Cloudflare production fail_open verified: false');
