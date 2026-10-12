'use strict';

// Strict TMDb evidence detector. Air dates are NOT a guarantee that video is
// actually playable: unknown, partial, weekly and unverified seasons fail closed.
const { localIsoDate, addIsoDays, normalizeIsoDate } = require('./calendar');

const BINGE_PERIODS = Object.freeze([
  { key: 'thisweek', label: 'Cette semaine' },
  { key: 'lastweek', label: 'Semaine passée' },
  { key: 'thismonth', label: 'Ce mois-ci' },
  { key: 'lastmonth', label: 'Le mois dernier' },
  { key: 'thisyear', label: 'Cette année' }
]);

function bingeWatchWindow(period, now = new Date(), timeZone = 'Europe/Paris') {
  if (!BINGE_PERIODS.some((p) => p.key === period)) return null;
  const today = localIsoDate(now, timeZone);
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  const monday = addIsoDays(today, -((weekday + 6) % 7));
  const [year, month] = today.split('-').map(Number);
  let start;
  let end = today;
  if (period === 'thisweek') start = monday;
  if (period === 'lastweek') {
    start = addIsoDays(monday, -7);
    end = addIsoDays(monday, -1);
  }
  if (period === 'thismonth') start = today.slice(0, 7) + '-01';
  if (period === 'lastmonth') {
    const d = new Date(Date.UTC(year, month - 2, 1));
    start = d.toISOString().slice(0, 10);
    end = addIsoDays(today.slice(0, 7) + '-01', -1);
  }
  if (period === 'thisyear') start = year + '-01-01';
  return { start, end, today, kind: 'binge-' + period, allowPast: true };
}

function frenchStreamingProviders(details) {
  const region = details && details['watch/providers'] &&
    details['watch/providers'].results && details['watch/providers'].results.FR;
  if (!region) return [];
  const entries = [...(region.flatrate || []), ...(region.free || []), ...(region.ads || [])];
  return [...new Set(entries.filter((p) => p && Number.isFinite(Number(p.provider_id)))
    .map((p) => String(p.provider_name || p.provider_id)))];
}

function fullSeasonDrop(details, summary, season, window) {
  if (!details || !summary || !season || !window) return null;
  const seasonNumber = Number(summary.season_number);
  const count = Number(summary.episode_count);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 ||
      !Number.isInteger(count) || count < 2 || count > 50 ||
      Number(season.season_number) !== seasonNumber) return null;

  const providers = frenchStreamingProviders(details);
  if (!providers.length) return null;
  if (!Array.isArray(season.episodes) || season.episodes.length !== count) return null;

  const episodeNumbers = new Set();
  let releaseDate = null;
  for (const episode of season.episodes) {
    const number = Number(episode && episode.episode_number);
    const date = normalizeIsoDate(episode && episode.air_date);
    if (!Number.isInteger(number) || number < 1 || number > count ||
        episodeNumbers.has(number) || !date || date > window.today) return null;
    if (releaseDate !== null && date !== releaseDate) return null;
    releaseDate = date;
    episodeNumbers.add(number);
  }
  if (episodeNumbers.size !== count || releaseDate < window.start ||
      releaseDate > window.end) return null;

  const declaredStart = normalizeIsoDate(summary.air_date);
  const seasonStart = normalizeIsoDate(season.air_date);
  if ((declaredStart && declaredStart !== releaseDate) ||
      (seasonStart && seasonStart !== releaseDate)) return null;

  return {
    seasonNumber,
    episodeCount: count,
    releaseDate,
    providers,
    isMiniseries: String(details.type || '').toLowerCase() === 'miniseries',
    evidence: 'tmdb-all-episodes-same-day-and-fr-watch-provider'
  };
}

function bingeWatchArtSvg(variant = 'cover') {
  const backdrop = variant === 'backdrop';
  const w = backdrop ? 1920 : 1600, h = backdrop ? 1080 : 900;
  const frames = Array.from({ length: 7 }, (_, i) => {
    const x = 680 + i * 176, y = 125 + (i % 3) * 64;
    const tint = ['#24497d','#725090','#225a8c','#534479','#70415d','#2b597d','#5b3f83'][i];
    return '<g transform="translate(' + x + ' ' + y + ') rotate(' + (i - 3) * 5 +
      ' 110 260)" opacity=".76"><rect width="225" height="450" rx="22" fill="' + tint +
      '" stroke="#a8b8ef" stroke-opacity=".22" stroke-width="5"/>' +
      '<circle cx="110" cy="154" r="65" fill="#070d22" fill-opacity=".64"/>' +
      '<path d="M0 445 Q20 235 112 235 Q202 235 225 445Z" fill="#060d23" fill-opacity=".72"/>' +
      '<rect x="18" y="361" width="189" height="6" rx="3" fill="#b9d7fb" opacity=".24"/></g>';
  }).join('');
  const overlay = '<rect width="' + w + '" height="' + h + '" fill="url(#veil)"/>' +
    '<path d="M0 ' + (h - 120) + ' Q' + (w / 2) + ' ' + (h - 225) + ' ' + w + ' ' +
      (h - 112) + ' V' + h + ' H0Z" fill="#070713" opacity=".8"/>';
  const copy = backdrop ? '' :
    '<rect x="88" y="125" width="11" height="494" rx="5" fill="#b494ff"/>' +
    '<text x="139" y="280" font-family="DejaVu Sans,sans-serif" font-size="118" ' +
      'font-weight="900" letter-spacing="-4" fill="#fff">BINGE WATCH</text>' +
    '<text x="147" y="388" font-family="DejaVu Sans,sans-serif" font-size="83" ' +
      'font-weight="800" letter-spacing="10" fill="#ddc6ff">SÉRIES</text>' +
    '<rect x="139" y="441" width="520" height="74" rx="34" fill="#b291f5"/>' +
    '<text x="174" y="492" font-family="DejaVu Sans,sans-serif" font-size="33" ' +
      'font-weight="800" fill="#121026">TOUS LES ÉPISODES DISPO</text>';
  const corners = backdrop ? '' :
    '<path fill="#050611" d="M0 0H65A65 65 0 0 0 0 65Z M1535 0H1600V65A65 65 0 0 0 1535 0Z ' +
      'M0 835A65 65 0 0 0 65 900H0Z M1535 900A65 65 0 0 0 1600 835V900Z"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
    '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<defs><linearGradient id="base" x2="1" y2="1"><stop stop-color="#06071a"/>' +
      '<stop offset=".52" stop-color="#182147"/><stop offset="1" stop-color="#371c53"/></linearGradient>' +
      '<linearGradient id="veil"><stop stop-color="#040611" stop-opacity=".97"/>' +
      '<stop offset=".54" stop-color="#05091b" stop-opacity=".72"/>' +
      '<stop offset="1" stop-color="#0a0820" stop-opacity=".12"/></linearGradient></defs>' +
    '<rect width="' + w + '" height="' + h + '" fill="url(#base)"/>' +
    '<circle cx="' + (w * .81) + '" cy="' + (h * .29) +
      '" r="485" fill="#715bc9" opacity=".25"/>' +
    '<g>' + frames + '</g>' + overlay + copy + corners + '</svg>';
}

module.exports = { BINGE_PERIODS, bingeWatchWindow, frenchStreamingProviders, fullSeasonDrop, bingeWatchArtSvg };
