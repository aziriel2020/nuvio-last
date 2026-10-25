'use strict';

const { decorateCatalogMetas } = require('../../fr/api/index.js')._internals;
const { fastContentCards } = require('../../fr/api/fast-content-cards.cjs');
function decorateMovieMetas(origin, metas, descriptor) {
  const franceOrigin = new URL('../fr', `${origin}/`).href;
  const period = /^\d{4}-\d{2}$/.test(descriptor.period) ? `archive-${descriptor.period}` : descriptor.period;
  return metas.map((meta) => {
    const specific = meta.providersByKind?.[descriptor.view]?.[0];
    const label = descriptor.view === 'cinema' || meta.movieReleaseKind === 'cinema' ? 'CINÉMA FRANCE'
      : specific || (descriptor.view === 'streaming' ? 'STREAMING FRANCE' : descriptor.view === 'vod' ? 'VOD FRANCE'
        : meta.streamingProviders?.[0] || (meta.movieReleaseKind === 'digital' ? 'VOD FRANCE' : 'FILMS FRANCE'));
    const decorated = decorateCatalogMetas(franceOrigin, [meta], { type: 'movie', period, forceLandscapeCards: true, cardProvider: label }, 'Europe/Brussels')[0];
    const fast = fastContentCards(franceOrigin, meta, decorated);
    if (!meta.poster && !meta.background) {
      const image = new URL(fast.background); image.searchParams.set('provider', label);
      for (const field of ['poster', 'background', 'landscapePoster', 'banner']) fast[field] = image.href;
    }
    return fast;
  });
}
module.exports = { decorateMovieMetas };
