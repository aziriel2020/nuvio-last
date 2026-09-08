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

async function postAniList(variables) {
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'NuvioCalendar/diagnostic' },
    body: JSON.stringify({ query: QUERY, variables })
  });
  const text = await response.text();
  console.log('ANILIST HTTP', response.status, text.replace(/\s+/g, ' ').slice(0, 320));
  return { response, payload: JSON.parse(text) };
}

test('live upstream availability and cached AniList-derived fallback for 2026-09-09', async () => {
  const start = Math.floor(new Date('2026-09-08T15:00:00.000Z').getTime() / 1000) - 1;
  const end = Math.floor(new Date('2026-09-09T15:00:00.000Z').getTime() / 1000);
  const direct = await postAniList({ page: 1, start, end });
  console.log('ANILIST DIRECT OK', direct.response.ok, 'ERRORS', JSON.stringify(direct.payload?.errors || []));

  const fallbackUrl = 'https://tsuzuki.top/api/v1/schedule?start=2026-09-09&days=1&airType=raw';
  const fallbackResponse = await fetch(fallbackUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'NuvioCalendar/diagnostic' }
  });
  const fallbackText = await fallbackResponse.text();
  console.log('TSUZUKI HTTP', fallbackResponse.status, fallbackResponse.headers.get('content-type'));
  console.log('TSUZUKI BODY', fallbackText.replace(/\s+/g, ' ').slice(0, 2500));
  assert.equal(fallbackResponse.ok, true, `Tsuzuki HTTP ${fallbackResponse.status}: ${fallbackText.slice(0, 500)}`);
  const fallback = JSON.parse(fallbackText);
  const episodes = Array.isArray(fallback?.episodes) ? fallback.episodes : [];
  console.log('TSUZUKI COUNT', episodes.length);
  console.log('TSUZUKI SAMPLE', JSON.stringify(episodes.slice(0, 20)));
  assert.ok(episodes.length > 0, 'cached AniList-derived schedule should not be empty');
});
