'use strict';

function unavailable(path) {
  const error = new Error(`Cloudflare runtime has no local filesystem asset at ${String(path || '')}`);
  error.code = 'ENOENT';
  throw error;
}

module.exports = {
  readFileSync: unavailable
};
