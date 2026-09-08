'use strict';

const crypto = require('crypto');

const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const GITHUB_OIDC_AUDIENCE = 'nuvio-cloudflare-secret-migration';
const ALLOWED_REPOSITORY = 'aziriel2020/nuvio-last';
const ALLOWED_REF = 'refs/heads/main';
const CLOUDFLARE_ACCOUNT_ID = '7b21859ab1740325151b97717cedc0e7';
const CLOUDFLARE_PROJECT_NAME = 'nuvio-last-aziriel2020-1343705637';

let jwksCache = null;
let jwksExpiresAt = 0;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function decodeJsonPart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function audienceIncludes(aud, expected) {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

async function githubJwks() {
  const now = Date.now();
  if (jwksCache && now < jwksExpiresAt) return jwksCache;
  const response = await fetch(GITHUB_OIDC_JWKS, {
    headers: { Accept: 'application/json', 'User-Agent': 'NuvioCloudflareMigration/1.0' }
  });
  if (!response.ok) throw new Error(`GitHub JWKS HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.keys)) throw new Error('Invalid GitHub JWKS');
  jwksCache = payload.keys;
  jwksExpiresAt = now + 10 * 60 * 1000;
  return jwksCache;
}

async function verifyGithubOidc(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid OIDC token');

  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported OIDC signing algorithm');

  const keys = await githubJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('Unknown GitHub OIDC signing key');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const validSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url')
  );
  if (!validSignature) throw new Error('Invalid GitHub OIDC signature');

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== GITHUB_OIDC_ISSUER) throw new Error('Invalid OIDC issuer');
  if (!audienceIncludes(claims.aud, GITHUB_OIDC_AUDIENCE)) throw new Error('Invalid OIDC audience');
  if (!Number.isFinite(claims.exp) || claims.exp < now - 10) throw new Error('Expired OIDC token');
  if (Number.isFinite(claims.nbf) && claims.nbf > now + 10) throw new Error('OIDC token not active yet');
  if (claims.repository !== ALLOWED_REPOSITORY) throw new Error('OIDC repository is not allowed');
  if (claims.ref !== ALLOWED_REF) throw new Error('OIDC ref is not allowed');
  if (!String(claims.workflow_ref || '').includes(`${ALLOWED_REPOSITORY}/.github/workflows/deploy-cloudflare.yml@${ALLOWED_REF}`)) {
    throw new Error('OIDC workflow is not allowed');
  }

  return claims;
}

function migrationEnvVars() {
  const envVars = {};
  const migrated = [];

  const secretNames = ['TMDB_READ_TOKEN', 'TMDB_API_KEY'];
  for (const name of secretNames) {
    const value = String(process.env[name] || '').trim();
    if (!value) continue;
    envVars[name] = { type: 'secret_text', value };
    migrated.push(name);
  }

  const plainNames = [
    'TMDB_LANGUAGE',
    'MAX_CANDIDATES',
    'MAX_ITEMS',
    'PAGE_SIZE',
    'TMDB_TIMEOUT_MS',
    'SOURCE_TIMEOUT_MS',
    'RETRY_BASE_MS',
    'TMDB_RETRY_BASE_MS',
    'CALENDAR_CARDS'
  ];
  for (const name of plainNames) {
    const value = String(process.env[name] || '').trim();
    if (!value) continue;
    envVars[name] = { type: 'plain_text', value };
    migrated.push(name);
  }

  return { envVars, migrated };
}

async function writeCloudflareEnvironment(cloudflareToken, envVars) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${CLOUDFLARE_PROJECT_NAME}`;
  const deploymentConfig = {
    compatibility_date: '2026-09-08',
    env_vars: envVars
  };

  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${cloudflareToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      deployment_configs: {
        production: deploymentConfig,
        preview: deploymentConfig
      }
    })
  });

  if (response.ok) return;

  let safeErrors = [];
  try {
    const payload = await response.json();
    safeErrors = (payload?.errors || []).map((error) => ({
      code: error?.code || null,
      message: error?.message || 'Cloudflare API error'
    }));
  } catch {
    safeErrors = [{ code: null, message: `Cloudflare HTTP ${response.status}` }];
  }

  const error = new Error('Cloudflare environment migration failed');
  error.status = response.status;
  error.safeErrors = safeErrors;
  throw error;
}

module.exports = async function migrateCloudflareSecret(req, res) {
  if (process.env.VERCEL !== '1') return sendJson(res, 404, { error: 'Not found' });
  if (String(req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const authorization = String(req.headers?.authorization || '');
  const oidcToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const cloudflareToken = String(req.headers?.['x-cloudflare-token'] || '').trim();

  if (!oidcToken || !cloudflareToken) return sendJson(res, 401, { error: 'Migration authorization required' });

  try {
    const claims = await verifyGithubOidc(oidcToken);
    const { envVars, migrated } = migrationEnvVars();

    if (!envVars.TMDB_READ_TOKEN && !envVars.TMDB_API_KEY) {
      return sendJson(res, 500, {
        error: 'No TMDB_READ_TOKEN or TMDB_API_KEY is configured on the Vercel production deployment.'
      });
    }

    await writeCloudflareEnvironment(cloudflareToken, envVars);

    return sendJson(res, 200, {
      ok: true,
      repository: claims.repository,
      ref: claims.ref,
      migrated
    });
  } catch (error) {
    return sendJson(res, error?.status || 401, {
      error: String(error?.message || 'Secret migration failed'),
      cloudflareErrors: Array.isArray(error?.safeErrors) ? error.safeErrors : undefined
    });
  }
};

module.exports._internals = {
  verifyGithubOidc,
  migrationEnvVars,
  audienceIncludes
};
