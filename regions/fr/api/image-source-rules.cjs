'use strict';
const IMAGE_HOSTS = new Set(['image.tmdb.org', 'static.tvmaze.com', 's1.anilist.co',
  's2.anilist.co', 's3.anilist.co', 's4.anilist.co', 'img.anili.st']);
function isImageSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname.toLowerCase())
      && !url.username && !url.password && (!url.port || url.port === '443');
  } catch { return false; }
}
module.exports = { IMAGE_HOSTS, isImageSource };
