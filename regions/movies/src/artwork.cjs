'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const opentype = require('opentype.js');
const { GENRES } = require('./model.cjs');
const ROOT = path.resolve(__dirname, '../../../assets/movie-covers');
const REVISION = 'movies-premium-20261025-v2';
const cache = new Map();
const fonts = new Map();
function typePath(text, x, y, size, maxWidth, color = '#f8f7f3', weight = 'normal') {
  if (!fonts.has(weight)) fonts.set(weight, opentype.loadSync(require.resolve(`dejavu-fonts-ttf/ttf/DejaVuSans${weight === 'bold' ? '-Bold' : ''}.ttf`)));
  const font = fonts.get(weight);
  const actual = Math.min(size, size * maxWidth / Math.max(1, font.getAdvanceWidth(text, size)));
  return `<path d="${font.getPath(text, x, y, actual).toPathData(2)}" fill="${color}"/>`;
}
function cardSvg({ image = null, title, subtitle = 'STREAMING • VOD • CINÉMA' }) {
  const words = title.toLocaleUpperCase('fr-FR').split(' ');
  const lines = [''];
  for (const word of words) {
    const i = lines.length - 1;
    if ((lines[i] + ' ' + word).trim().length > 19 && lines.length < 2) lines.push(word);
    else lines[i] = (lines[i] + ' ' + word).trim();
  }
  const startY = lines.length > 1 ? 390 : 445;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs><clipPath id="clip"><rect x="20" y="18" width="1560" height="864" rx="24"/></clipPath>
    <linearGradient id="shade"><stop offset="0" stop-color="#141c2a"/><stop offset="1" stop-color="#03070d"/></linearGradient></defs>
    <g clip-path="url(#clip)"><rect width="1600" height="900" fill="url(#shade)"/>
    ${image ? `<image href="${image}" x="28" y="25" width="596" height="852" preserveAspectRatio="xMidYMid slice"/>` : ''}
    <path d="M624 25V877" stroke="#dbc28c" stroke-width="2"/>
    <rect x="668" y="165" width="852" height="582" rx="14" fill="#04080f" fill-opacity=".96"/>
    ${typePath('NUVIO / FILMS MONDIAUX', 708, 239, 28, 772, '#dec28a')}
    <path d="M708 265H1480" stroke="#dec28a" stroke-width="2"/>
    ${lines.map((line, i) => typePath(line, 706, startY + i * 107, 100, 770, '#f8f7f3', 'bold')).join('')}
    <path d="M708 543H1480" stroke="#dec28a" stroke-width="3"/>
    ${typePath(subtitle, 708, 600, 26, 770, '#d7dbe1')}
    ${typePath('MARCHÉ FRANÇAIS • TOUS SERVICES', 708, 645, 21, 770, '#9aa7b8')}
    </g><rect x="18" y="16" width="1564" height="868" rx="25" fill="none" stroke="#dec28a" stroke-width="3"/>
    </svg>`;
}
function genreBytes(id) {
  if (!GENRES.some((g) => g.id === id)) return null;
  const filename = path.join(ROOT, `${id}.webp`);
  return fs.existsSync(filename) ? fs.readFileSync(filename) : null;
}
function progress() { const loaded = GENRES.filter((g) => fs.existsSync(path.join(ROOT, `${g.id}.webp`))).length; return { loaded, total: GENRES.length, ready: loaded === GENRES.length, version: REVISION }; }
async function fallbackCard(title, label) {
  const key = `${title}:${label}`;
  if (!cache.has(key)) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, sharp(Buffer.from(cardSvg({ title, subtitle: label || 'FILM • FRANCE' }))).jpeg({ quality: 90 }).toBuffer());
  }
  return cache.get(key);
}
module.exports = { ROOT, REVISION, cardSvg, genreBytes, progress, fallbackCard };
