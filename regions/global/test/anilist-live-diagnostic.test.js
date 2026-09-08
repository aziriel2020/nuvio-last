'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'NuvioCalendar/diagnostic' } });
  const text = await response.text();
  assert.equal(response.ok, true, `${url} HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

test('cached AniList-derived bulk endpoints expose full JP/KR metadata', async () => {
  const schedule = await getJson('https://tsuzuki.top/api/v1/schedule?start=2026-09-09&days=1&airType=raw');
  console.log('SCHEDULE COUNT', schedule?.episodes?.length || 0);

  const season = await getJson('https://tsuzuki.top/api/v1/seasons/summer/2026?full=1');
  console.log('SEASON KEYS', JSON.stringify(Object.keys(season || {})));
  for (const [key, value] of Object.entries(season || {})) {
    if (Array.isArray(value)) console.log('SEASON ARRAY', key, value.length, JSON.stringify(value[0] || null).slice(0, 1000));
  }

  const airing = await getJson('https://tsuzuki.top/api/v1/airing?full=1');
  console.log('AIRING KEYS', JSON.stringify(Object.keys(airing || {})));
  for (const [key, value] of Object.entries(airing || {})) {
    if (Array.isArray(value)) console.log('AIRING ARRAY', key, value.length, JSON.stringify(value[0] || null).slice(0, 1000));
  }

  assert.ok(Array.isArray(schedule?.episodes) && schedule.episodes.length > 0);
});
