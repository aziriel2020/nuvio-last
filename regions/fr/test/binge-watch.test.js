'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BINGE_PERIODS, bingeWatchWindow, fullSeasonDrop, bingeWatchArtSvg } = require('../src/binge-watch');

const now = new Date('2026-10-12T10:00:00+02:00');
const todayWindow = bingeWatchWindow('thisweek', now, 'Europe/Paris');
const fullShow = {
  id: 1234,
  type: 'Miniseries',
  'watch/providers': { results: { FR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } }
};
const summary = { season_number: 1, episode_count: 4, air_date: '2026-10-12' };
function season(dates = Array(4).fill('2026-10-12')) {
  return {
    season_number: 1,
    air_date: '2026-10-12',
    episodes: dates.map((air_date, i) => ({ episode_number: i + 1, air_date }))
  };
}

test('exact calendar week/month/year windows with local day and no future dates', () => {
  assert.deepEqual(BINGE_PERIODS.map((p) => p.key),
    ['thisweek', 'lastweek', 'thismonth', 'lastmonth', 'thisyear']);
  const expected = [
    ['thisweek', '2026-10-12', '2026-10-12'],
    ['lastweek', '2026-10-05', '2026-10-11'],
    ['thismonth', '2026-10-01', '2026-10-12'],
    ['lastmonth', '2026-09-01', '2026-09-30'],
    ['thisyear', '2026-01-01', '2026-10-12']
  ];
  for (const [key, start, end] of expected) {
    const window = bingeWatchWindow(key, now, 'Europe/Paris');
    assert.equal(window.start, start, key);
    assert.equal(window.end, end, key);
    assert.equal(window.today, '2026-10-12', key);
  }
  assert.equal(bingeWatchWindow('not-a-period', now), null);
});

test('admit full same-day mini-series on French streaming, with explicit evidence', () => {
  const match = fullSeasonDrop(fullShow, summary, season(), todayWindow);
  assert.equal(match.episodeCount, 4);
  assert.equal(match.releaseDate, '2026-10-12');
  assert.equal(match.isMiniseries, true);
  assert.deepEqual(match.providers, ['Netflix']);
  assert.match(match.evidence, /same-day/);
});

test('exclude partial, weekly, future, mismatched or unverified episodes', () => {
  assert.equal(fullSeasonDrop(fullShow, summary,
    season(['2026-10-12', '2026-10-13', '2026-10-12', '2026-10-12']), todayWindow), null);
  assert.equal(fullSeasonDrop(fullShow, summary,
    season(['2026-10-12', '2026-10-12', '2026-10-12']), todayWindow), null);
  const duplicated = season();
  duplicated.episodes[3].episode_number = 1;
  assert.equal(fullSeasonDrop(fullShow, summary, duplicated, todayWindow), null);
  const noFrenchProvider = { ...fullShow, 'watch/providers': { results: { US: { flatrate: [{ provider_id: 8 }] } } } };
  assert.equal(fullSeasonDrop(noFrenchProvider, summary, season(), todayWindow), null);
  const badCount = { ...summary, episode_count: 5 };
  assert.equal(fullSeasonDrop(fullShow, badCount, season(), todayWindow), null);
  const badSummary = { ...summary, air_date: '2026-10-11' };
  assert.equal(fullSeasonDrop(fullShow, badSummary, season(), todayWindow), null);
  assert.equal(fullSeasonDrop(fullShow, summary, season(),
    bingeWatchWindow('lastweek', now, 'Europe/Paris')), null);
});

test('artwork is distinct cover and text-free hero in native cinematic sizes', () => {
  const cover = bingeWatchArtSvg('cover');
  const hero = bingeWatchArtSvg('backdrop');
  assert.match(cover, /width="1600" height="900"/);
  assert.match(hero, /width="1920" height="1080"/);
  assert.match(cover, /BINGE WATCH/);
  assert.match(cover, /TOUS LES ÉPISODES DISPO/);
  assert(!hero.includes('TOUS LES ÉPISODES DISPO'));
});
