'use strict';

const { decorateCatalogMetas } = require('../../fr/api/index.js')._internals;
function decorateMovieMetas(origin, metas, descriptor) {
  const franceOrigin = new URL('../fr', `${origin}/`).href;
  const period = /^\d{4}-\d{2}$/.test(descriptor.period) ? `archive-${descriptor.period}` : descriptor.period;
  return metas.map((meta) => {
    const specific = meta.providersByKind?.[descriptor.view]?.[0];
    const label = descriptor.view === 'cinema' || meta.movieReleaseKind === 'cinema' ? 'CINÉMA FRANCE'
      : specific || (descriptor.view === 'streaming' ? 'STREAMING FRANCE' : descriptor.view === 'vod' ? 'VOD FRANCE'
        : meta.streamingProviders?.[0] || (meta.movieReleaseKind === 'digital' ? 'VOD FRANCE' : 'FILMS FRANCE'));
    const decorated = decorateCatalogMetas(franceOrigin, [meta], { type: 'movie', period, forceLandscapeCards: true, cardProvider: label }, 'Europe/Brussels')[0];
    if (!meta.poster && !meta.background) {
      const params = new URLSearchParams({ title: meta.name, label, v: 'movies-v1' });
      for (const key of ['poster', 'background', 'landscapePoster', 'banner']) decorated[key] = `${origin}/content-card.jpg?${params}`;
    } else for (const key of ['poster', 'background', 'landscapePoster']) {
      if (!decorated[key]?.includes('/calendar-card.svg?')) continue;
      const image = new URL(decorated[key]);
      image.searchParams.set('v', `${image.searchParams.get('v')}-movies-jpeg-v1`);
      decorated[key] = image.href;
    }
    return decorated;
  });
}
module.exports = { decorateMovieMetas };
