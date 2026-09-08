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
      media { id countryOfOrigin format isAdult title { romaji english native } }
    }
  }
}`;

async function textFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  console.log('FETCH', url, 'HTTP', response.status, response.headers.get('content-type'));
  console.log('BODY', text.replace(/\s+/g, ' ').slice(0, 6500));
  return { response, text, payload: JSON.parse(text) };
}

test('live upstream availability and cached AniList-derived metadata for 2026-09-09', async () => {
  const start = Math.floor(new Date('2026-09-08T15:00:00.000Z').getTime() / 1000) - 1;
  const end = Math.floor(new Date('2026-09-09T15:00:00.000Z').getTime() / 1000);
  const direct = await textFetch(ANILIST_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'NuvioCalendar/diagnostic' },
    body: JSON.stringify({ query: QUERY, variables: { page: 1, start, end } })
  });
  console.log('ANILIST DIRECT OK', direct.response.ok, 'ERRORS', JSON.stringify(direct.payload?.errors || []));

  const schedule = await textFetch('https://tsuzuki.top/api/v1/schedule?start=2026-09-09&days=1&airType=raw', {
    headers: { Accept: 'application/json', 'User-Agent': 'NuvioCalendar/diagnostic' }
  });
  assert.equal(schedule.response.ok, true);
  assert.ok(Array.isArray(schedule.payload?.episodes) && schedule.payload.episodes.length > 0);

  for (const id of [135865, 184356, 199409]) {
    const full = await textFetch(`https://tsuzuki.top/api/v1/anime/${id}?full=1`, {
      headers: { Accept: 'application/json', 'User-Agent': 'NuvioCalendar/diagnostic' }
    });
    assert.equal(full.response.ok, true, `full metadata missing for ${id}`);
    console.log('FULL KEYS', id, JSON.stringify(Object.keys(full.payload || {})));
  }
});
