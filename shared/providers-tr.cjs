'use strict';
module.exports = [
  { slug: 'netflix', label: 'Netflix', aliases: ['Netflix', 'Netflix Standard with Ads'], monetizationTypes: ['flatrate'] },
  { slug: 'prime-video', label: 'Prime Video', aliases: ['Amazon Prime Video', 'Prime Video', 'Amazon Prime Video with Ads'], monetizationTypes: ['flatrate'] },
  { slug: 'disney-plus', label: 'Disney+', aliases: ['Disney Plus', 'Disney+'], monetizationTypes: ['flatrate'] },
  { slug: 'max', label: 'Max', aliases: ['Max', 'HBO Max'], matchPrefixes: ['max', 'hbo max'], monetizationTypes: ['flatrate'] },
  { slug: 'apple-tv-plus', label: 'Apple TV+', aliases: ['Apple TV Plus', 'Apple TV+'], monetizationTypes: ['flatrate'] },
  { slug: 'mubi', label: 'MUBI', aliases: ['MUBI', 'Mubi'], matchPrefixes: ['mubi'], monetizationTypes: ['flatrate'] },
  { slug: 'exxen', label: 'Exxen', aliases: ['Exxen'], matchPrefixes: ['exxen'], monetizationTypes: ['flatrate'] },
  { slug: 'gain', label: 'GAİN', aliases: ['GAİN', 'GAIN', 'Gain'], matchPrefixes: ['gain'], monetizationTypes: ['flatrate', 'free', 'ads'] },
  { slug: 'tabii', label: 'tabii', aliases: ['tabii', 'Tabii'], matchPrefixes: ['tabii'], monetizationTypes: ['flatrate', 'free', 'ads'] },
  { slug: 'tod', label: 'TOD', aliases: ['TOD', 'TOD TV', 'beIN CONNECT', 'beIN Connect'], matchPrefixes: ['tod', 'bein connect'], monetizationTypes: ['flatrate'] },
  { slug: 'puhutv', label: 'puhutv', aliases: ['puhutv', 'Puhu TV', 'PuhuTV'], matchPrefixes: ['puhutv', 'puhu tv'], monetizationTypes: ['flatrate', 'free', 'ads'] },
  { slug: 'tv-plus', label: 'TV+', aliases: ['TV+', 'Turkcell TV+', 'Turkcell TV Plus'], matchPrefixes: ['turkcell tv', 'tv+'], monetizationTypes: ['flatrate'] },
  { slug: 'tivibu', label: 'Tivibu', aliases: ['Tivibu'], matchPrefixes: ['tivibu'], monetizationTypes: ['flatrate'] },
  { slug: 'd-smart-go', label: 'D-Smart GO', aliases: ['D-Smart GO', 'D Smart GO', 'D-Smart'], matchPrefixes: ['d-smart', 'd smart'], monetizationTypes: ['flatrate'] },
  { slug: 's-sport-plus', label: 'S Sport Plus', aliases: ['S Sport Plus', 'S Sport+', 'S Sport'], matchPrefixes: ['s sport'], monetizationTypes: ['flatrate'] }
];
