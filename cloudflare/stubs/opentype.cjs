'use strict';

module.exports = {
  loadSync() {
    throw new Error('OpenType rendering is disabled in the Cloudflare runtime; image routes are handled by the Cloudflare edge adapter.');
  }
};
