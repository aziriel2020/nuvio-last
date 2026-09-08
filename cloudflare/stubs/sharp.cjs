'use strict';

function unavailableSharp() {
  throw new Error('Sharp rendering is disabled in the Cloudflare runtime; image routes are handled by the Cloudflare edge adapter.');
}

module.exports = unavailableSharp;
