'use strict';

const REVISION = 'fast-artwork-v3';
function fastContentCards(origin, meta, decorated) {
  const old = decorated.background || decorated.landscapePoster;
  const wide = old?.includes('/calendar-card.svg?') ? new URL(old) : new URL(`${origin}/calendar-card.jpg`);
  wide.pathname = wide.pathname.replace(/calendar-card\.svg$/, 'calendar-card.jpg');
  wide.searchParams.set('layout', 'landscape');
  // Films Monde native rows only need a responsive 16:9 poster, not a 960px
  // card generated for the large home carousel. The distinct profile is
  // intentionally opt-in; other FR/US/TV calendar cards remain unchanged.
  wide.searchParams.set('world', '1');
  wide.searchParams.set('v', REVISION);
  if (!wide.searchParams.has('title')) wide.searchParams.set('title', meta.name || '');
  if (!wide.searchParams.has('type')) wide.searchParams.set('type', meta.type || 'series');
  if (!wide.searchParams.has('append')) wide.searchParams.set('append', decorated.releaseInfo || '');
  if (!wide.searchParams.has('provider')) wide.searchParams.set('provider', meta.streamingProviders?.[0] || 'FRANCE');
  if (meta.poster) wide.searchParams.set('fallback', meta.poster);
  // All three native thumbnail fields share one bitmap and one decoder entry.
  for (const field of ['poster', 'background', 'landscapePoster']) decorated[field] = wide.href;
  if (decorated.banner?.includes('/desktop-content-card.jpg?')) {
    const desktop = new URL(decorated.banner);
    desktop.searchParams.set('fast', '1'); desktop.searchParams.set('v', REVISION);
    if (meta.poster) desktop.searchParams.set('fallback', meta.poster);
    decorated.banner = desktop.href;
  } else decorated.banner = wide.href;
  return decorated;
}
module.exports = { fastContentCards, REVISION };
