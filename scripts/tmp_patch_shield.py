from pathlib import Path

p = Path('api/index.js')
s = p.read_text()

old = """  const stripped = originalUrl.slice(prefix.length) || '/';
  req.url = stripped.startsWith('/') ? stripped : `/${stripped}`;
"""
new = """  let stripped = originalUrl.slice(prefix.length) || '/';
  stripped = stripped
    .replace(/^\\/shield-folder-card\\.jpg(?=\\?|$)/, '/desktop-folder-card.jpg')
    .replace(/^\\/shield-content-card\\.jpg(?=\\?|$)/, '/desktop-content-card.jpg')
    .replace(/^\\/shield-genre-card\\.jpg(?=\\?|$)/, '/desktop-genre-card.jpg');
  req.url = stripped.startsWith('/') ? stripped : `/${stripped}`;
"""
assert old in s, 'delegate anchor missing'
s = s.replace(old, new, 1)

anchor = "function desktopizeCollectionArt(collection) {\n"
insert = r"""const SHIELD_VISUAL_REV = 'shield13-cinematic-jpeg';

function shieldCollectionVisualUrl(url, folder = null, variant = 'card', collectionTitle = '') {
  const value = String(url || '');
  const typeContext = `${folder?.title || ''} ${collectionTitle || ''}`.toLowerCase();
  const type = typeContext.includes('film') ? 'movie' : 'series';

  if (value.includes('/platform-category-card.svg') || value.includes('/platform-card.jpg')) {
    const next = value
      .replace('/platform-category-card.svg', '/shield-folder-card.jpg')
      .replace('/platform-card.jpg', '/shield-folder-card.jpg');
    const cleaned = cleanVisualQuery(next, ['category', 'v']);
    const extra = new URLSearchParams({ type, v: SHIELD_VISUAL_REV, title: folder?.title || '', label: collectionTitle || '' });
    return cleaned + (cleaned.includes('?') ? '&' : '?') + extra.toString();
  }

  if (value.includes('/genre-folder-art.svg') || value.includes('/genre-card.jpg')) {
    const next = value
      .replace('/genre-folder-art.svg', '/shield-genre-card.jpg')
      .replace('/genre-card.jpg', '/shield-genre-card.jpg');
    const colorMatch = value.match(/[?&]color=([^&]+)/);
    const cleaned = cleanVisualQuery(next, ['variant', 'label', 'type', 'icon', 'v', 'color']);
    const extra = new URLSearchParams({ type, v: SHIELD_VISUAL_REV, title: folder?.title || '', label: collectionTitle || '' });
    if (colorMatch) {
      let color = colorMatch[1];
      try { color = decodeURIComponent(color); } catch {}
      extra.set('color', color);
    }
    return cleaned + (cleaned.includes('?') ? '&' : '?') + extra.toString();
  }

  if (variant === 'backdrop' && value.includes('/platform-backdrop.svg')) {
    const cleaned = cleanVisualQuery(value.replace('/platform-backdrop.svg', '/platform-backdrop.jpg'), ['type', 'v']);
    return cleaned + (cleaned.includes('?') ? '&' : '?') + `v=${SHIELD_VISUAL_REV}`;
  }

  return value;
}

function shieldizeCollectionArt(collection) {
  const folders = (collection.folders || []).map((folder) => ({
    ...folder,
    coverImageUrl: shieldCollectionVisualUrl(folder.coverImageUrl, folder, 'card', collection.title),
    focusGifUrl: null,
    focusGifEnabled: false,
    hideTitle: true,
    heroBackdropUrl: shieldCollectionVisualUrl(folder.heroBackdropUrl, folder, 'backdrop', collection.title)
  }));
  return {
    ...collection,
    backdropImageUrl: shieldCollectionVisualUrl(collection.backdropImageUrl, null, 'backdrop', collection.title),
    folders
  };
}

"""
assert anchor in s, 'desktopize anchor missing'
s = s.replace(anchor, insert + anchor, 1)

old = """function combinedDesktopCollections(req) {
  return combinedCollections(req).map(desktopizeCollectionArt);
}

function combinedCollections(req) {
"""
new = """function combinedDesktopCollections(req) {
  return combinedRawCollections(req).map(desktopizeCollectionArt);
}

function combinedCollections(req) {
  return combinedRawCollections(req).map(shieldizeCollectionArt);
}

function combinedRawCollections(req) {
"""
assert old in s, 'combined collection anchor missing'
s = s.replace(old, new, 1)

old = "  if (path === '/nuvio-collections-fr-global-tr-usa.json' || path === '/nuvio-collections-fr-global-usa.json' || path === '/nuvio-collections-usa-fr.json' || path === '/collections.json') {\n"
new = "  if (path === '/nuvio-collections-fr-global-tr-usa.json' || path === '/nuvio-collections-shield.json' || path === '/nuvio-collections-fr-global-usa.json' || path === '/nuvio-collections-usa-fr.json' || path === '/collections.json') {\n"
assert old in s, 'standard route anchor missing'
s = s.replace(old, new, 1)

old = """      globalHandler._internals.buildNuvioCollectionsImport(
        globalHandler._internals.runtimeNow(),
        globalHandler._internals.requestTimeZone(req),
        `${origin}/global`
      ),
"""
new = """      globalHandler._internals.buildNuvioCollectionsImport(
        globalHandler._internals.runtimeNow(),
        globalHandler._internals.requestTimeZone(req),
        `${origin}/global`
      ).map(shieldizeCollectionArt),
"""
assert old in s, 'global route anchor missing'
s = s.replace(old, new, 1)

old = """      trHandler._internals.buildNuvioCollectionsImport(
        trHandler._internals.runtimeNow(),
        trHandler._internals.requestTimeZone(req),
        `${origin}/tr`
      ),
"""
new = """      trHandler._internals.buildNuvioCollectionsImport(
        trHandler._internals.runtimeNow(),
        trHandler._internals.requestTimeZone(req),
        `${origin}/tr`
      ).map(shieldizeCollectionArt),
"""
assert old in s, 'tr route anchor missing'
s = s.replace(old, new, 1)

old = """      combinedCollections: `${origin}/nuvio-collections-fr-global-tr-usa.json`,
      desktopCollections: `${origin}/nuvio-collections-desktop.json`,
"""
new = """      combinedCollections: `${origin}/nuvio-collections-fr-global-tr-usa.json`,
      shieldCollections: `${origin}/nuvio-collections-shield.json`,
      desktopCollections: `${origin}/nuvio-collections-desktop.json`,
"""
assert old in s, 'install anchor missing'
s = s.replace(old, new, 1)

old = """  combinedCollections,
  combinedDesktopCollections,
  desktopizeCollectionArt,
"""
new = """  combinedCollections,
  combinedRawCollections,
  combinedDesktopCollections,
  shieldizeCollectionArt,
  shieldCollectionVisualUrl,
  desktopizeCollectionArt,
"""
assert old in s, 'exports anchor missing'
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('test/coexist.test.js')
s = p.read_text()
anchor = "test('desktop import uses dedicated cinematic raster covers with native folder titles', async () => {\n"
insert = r"""test('Shield import uses dedicated cinematic raster covers while preserving TV title behavior', async () => {
  const response = await call('/nuvio-collections-shield.json');
  assert.equal(response.statusCode, 200);
  assertCdnCache(response, 86400);
  const collections = JSON.parse(response.text);
  assert.equal(collections.length, 49);

  const targets = [
    collections.find((c) => c.title === '🇫🇷 Netflix'),
    collections.find((c) => c.title === '🌍 VOD Mondiale'),
    collections.find((c) => c.title === '🇹🇷 Netflix'),
    collections.find((c) => c.title === '🇺🇸 Netflix'),
  ];
  for (const collection of targets) {
    assert(collection);
    assert.match(collection.backdropImageUrl, /\/platform-backdrop\.jpg\?provider=/);
    for (const folder of collection.folders) {
      assert.equal(folder.hideTitle, true);
      assert.equal(folder.focusGifEnabled, false);
      assert.equal(folder.focusGifUrl, null);
      assert.match(folder.coverImageUrl, /\/shield-folder-card\.jpg\?provider=/);
      assert.match(folder.coverImageUrl, /[?&]v=shield13-cinematic-jpeg/);
      assert.match(folder.coverImageUrl, /[?&]title=/);
      assert.match(folder.heroBackdropUrl, /\/platform-backdrop\.jpg\?provider=/);
    }
  }

  const frGenres = collections.find((c) => c.title === '🇫🇷 Genres · Films');
  assert(frGenres?.folders?.length > 0);
  assert.match(frGenres.folders[0].coverImageUrl, /\/shield-genre-card\.jpg\?genre=/);
  assert.match(frGenres.folders[0].coverImageUrl, /[?&]v=shield13-cinematic-jpeg/);
});

test('Shield cinematic aliases resolve to native 1600x900 JPEG renderers in every region', async () => {
  const urls = [
    '/fr/shield-folder-card.jpg?provider=netflix&type=series&title=S%C3%A9ries&label=Netflix&v=shield13-cinematic-jpeg',
    '/global/shield-folder-card.jpg?provider=vod-global&type=movie&title=Films&label=VOD%20Mondiale&v=shield13-cinematic-jpeg',
    '/tr/shield-folder-card.jpg?provider=netflix&type=series&title=Diziler&label=Netflix&v=shield13-cinematic-jpeg',
    '/us/shield-folder-card.jpg?provider=netflix&type=movie&title=Films&label=Netflix&v=shield13-cinematic-jpeg',
  ];
  for (const url of urls) {
    const response = await call(url);
    assert.equal(response.statusCode, 200, url);
    assert.match(response.headers['content-type'], /image\/jpeg/, url);
    assert.equal(response.headers['x-nuvio-card-renderer'], 'shield-desktop-jpeg-v4', url);
    assert.equal(response.headers['x-nuvio-desktop-format'], '1600x900', url);
    assert.equal(response.body[0], 0xff, url);
    assert.equal(response.body[1], 0xd8, url);
    assert(response.body.length > 1000, url);
  }
});

"""
assert anchor in s, 'test insertion anchor missing'
s = s.replace(anchor, insert + anchor, 1)
p.write_text(s)

p = Path('scripts/verify-oracle-production.mjs')
s = p.read_text()
old = """  if (/\\/desktop-(?:content|folder|genre)-card\\.jpg$/.test(url.pathname)) {
    assert(type.startsWith('image/jpeg'), `${label}: Desktop card must be a native JPEG, got ${type}`);
    assert(result.response.headers.get('x-nuvio-card-renderer') === 'shield-desktop-jpeg-v4', `${label}: Desktop renderer marker missing`);
    assert(result.response.headers.get('x-nuvio-desktop-format') === '1600x900', `${label}: Desktop format marker missing`);
    assert(result.bytes[0] === 0xff && result.bytes[1] === 0xd8, `${label}: invalid JPEG signature`);
    const metadata = await sharp(result.bytes).metadata();
    assert(metadata.format === 'jpeg' && metadata.width === 1600 && metadata.height === 900, `${label}: expected 1600x900 JPEG, got ${metadata.format} ${metadata.width}x${metadata.height}`);
  }
"""
new = """  if (/\\/(?:desktop|shield)-(?:content|folder|genre)-card\\.jpg$/.test(url.pathname)) {
    assert(type.startsWith('image/jpeg'), `${label}: cinematic card must be a native JPEG, got ${type}`);
    assert(result.response.headers.get('x-nuvio-card-renderer') === 'shield-desktop-jpeg-v4', `${label}: cinematic renderer marker missing`);
    assert(result.response.headers.get('x-nuvio-desktop-format') === '1600x900', `${label}: cinematic format marker missing`);
    assert(result.bytes[0] === 0xff && result.bytes[1] === 0xd8, `${label}: invalid JPEG signature`);
    const metadata = await sharp(result.bytes).metadata();
    assert(metadata.format === 'jpeg' && metadata.width === 1600 && metadata.height === 900, `${label}: expected 1600x900 JPEG, got ${metadata.format} ${metadata.width}x${metadata.height}`);
  }
"""
assert old in s, 'verifier JPEG anchor missing'
s = s.replace(old, new, 1)

old = """  '/nuvio-collections-fr-global-tr-usa.json',
  '/nuvio-collections-desktop.json',
"""
new = """  '/nuvio-collections-fr-global-tr-usa.json',
  '/nuvio-collections-shield.json',
  '/nuvio-collections-desktop.json',
"""
assert old in s, 'required paths anchor missing'
s = s.replace(old, new, 1)

old = """assert(Array.isArray(standard) && standard.length > 0, 'standard collection import empty');
assert(Array.isArray(desktop) && desktop.length === standard.length, `Desktop count ${desktop?.length} != standard ${standard.length}`);
"""
new = """assert(Array.isArray(standard) && standard.length > 0, 'standard collection import empty');
const shieldAlias = payloads['/nuvio-collections-shield.json'];
assert(Array.isArray(shieldAlias) && shieldAlias.length === standard.length, `Shield count ${shieldAlias?.length} != standard ${standard.length}`);
const shieldVisualUrls = flattenStrings(standard).filter((value) => {
  try { return /\\/shield-(?:folder|genre)-card\\.jpg$/.test(new URL(value).pathname); } catch { return false; }
});
assert(shieldVisualUrls.length > 0, 'Shield collection import has no native cinematic card URLs');
for (const value of shieldVisualUrls) {
  const visualUrl = new URL(value);
  assert(visualUrl.origin === ORIGIN, `Shield collection visual escaped Oracle: ${value}`);
  assert(visualUrl.searchParams.get('v')?.includes('shield13-cinematic-jpeg'), `Shield collection visual has stale renderer revision: ${value}`);
}
assert(Array.isArray(desktop) && desktop.length === standard.length, `Desktop count ${desktop?.length} != standard ${standard.length}`);
"""
assert old in s, 'shield verifier anchor missing'
s = s.replace(old, new, 1)
p.write_text(s)
