'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ANILIST_URL = 'https://graphql.anilist.co';
const QUERY = `
query ($page: Int, $start: Int, $end: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { currentPage hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME_DESC) {
      id airingAt episode mediaId
      media {
        id countryOfOrigin format isAdult
        title { romaji english native }
      }
    }
  }
}`;

const MEDIA_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id countryOfOrigin format isAdult status
    title { romaji english native }
    nextAiringEpisode { id airingAt episode }
  }
}`;

async function post(query, variables) {
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'NuvioCalendar/diagnostic' },
    body: JSON.stringify({ query, variables })
  });
  const text = await response.text();
  console.log('ANILIST HTTP', response.status, response.headers.get('content-type'));
  assert.equal(response.ok, true, `AniList HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text);
  assert.equal(Array.isArray(payload.errors), false, JSON.stringify(payload.errors || []));
  return payload;
}

test('live AniList schedules for 2026-09-09 JST', async () => {
  const start = Math.floor(new Date('2026-09-08T15:00:00.000Z').getTime() / 1000) - 1;
  const end = Math.floor(new Date('2026-09-09T15:00:00.000Z').getTime() / 1000);
  const all = [];
  for (let page = 1; page <= 4; page += 1) {
    const payload = await post(QUERY, { page, start, end });
    const section = payload?.data?.Page;
    const rows = section?.airingSchedules || [];
    console.log('ANILIST PAGE', page, 'ROWS', rows.length, 'HAS_NEXT', Boolean(section?.pageInfo?.hasNextPage));
    all.push(...rows);
    if (!section?.pageInfo?.hasNextPage) break;
  }

  const countries = {};
  const formats = {};
  for (const row of all) {
    const country = String(row?.media?.countryOfOrigin || '<null>');
    const format = String(row?.media?.format || '<null>');
    countries[country] = (countries[country] || 0) + 1;
    formats[format] = (formats[format] || 0) + 1;
  }
  const eligible = all.filter((row) =>
    !row?.media?.isAdult &&
    ['JP', 'KR'].includes(String(row?.media?.countryOfOrigin || '').toUpperCase()) &&
    String(row?.media?.format || '').toUpperCase() !== 'MOVIE'
  );

  console.log('ANILIST RAW COUNT', all.length);
  console.log('ANILIST COUNTRIES', JSON.stringify(countries));
  console.log('ANILIST FORMATS', JSON.stringify(formats));
  console.log('ANILIST ELIGIBLE COUNT', eligible.length);
  console.log('ANILIST ELIGIBLE SAMPLE', JSON.stringify(eligible.slice(0, 20).map((row) => ({
    mediaId: row.mediaId,
    episode: row.episode,
    airingAt: row.airingAt,
    country: row.media?.countryOfOrigin,
    format: row.media?.format,
    title: row.media?.title?.english || row.media?.title?.romaji || row.media?.title?.native
  }))));

  const known = await post(MEDIA_QUERY, { id: 135865 });
  console.log('ANILIST YOUJO SENKI II', JSON.stringify(known?.data?.Media || null));
  assert.ok(Array.isArray(all));
});
