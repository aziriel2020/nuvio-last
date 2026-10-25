'use strict';

const { decorateCatalogMetas } = require('../../fr/api/index.js')._internals;
const { fastContentCards } = require('../../fr/api/fast-content-cards.cjs');

// Use the same portrait, Modern Shield backdrop and Desktop banner renderers
// as the existing France calendars. Detail metadata keeps its original art.
function decorateSeriesMetas(origin, metas, descriptor) {
  const franceOrigin = new URL('../fr', `${origin}/`).href;
  const period = /^\d{4}-\d{2}$/.test(descriptor.period)
    ? `archive-${descriptor.period}` : descriptor.period;
  return metas.map((meta) => {
    const decorated = decorateCatalogMetas(franceOrigin, [meta], {
      type: 'series', period, forceLandscapeCards: true,
      cardProvider: meta.streamingProviders?.[0] || 'STREAMING FRANCE'
    }, 'Europe/Brussels')[0];
    return fastContentCards(franceOrigin, meta, decorated);
  });
}

module.exports = { decorateSeriesMetas };
