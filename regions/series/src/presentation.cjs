'use strict';

const { decorateCatalogMetas } = require('../../fr/api/index.js')._internals;

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
    for (const key of ['poster', 'background', 'landscapePoster']) {
      if (!decorated[key]?.includes('/calendar-card.svg?')) continue;
      const image = new URL(decorated[key]);
      image.searchParams.set('v', `${image.searchParams.get('v')}-series-jpeg-v1`);
      decorated[key] = image.href;
    }
    return decorated;
  });
}

module.exports = { decorateSeriesMetas };
