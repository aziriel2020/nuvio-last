'use strict';

const FILM_DETAILS_PROFILE = 'oracle-vector-v4-film-details';
const MOVIE_VECTOR_TTL = 6 * 60 * 60;
const MOVIE_VECTOR_GRACE = 3 * 24 * 60 * 60;
const MOVIE_ID = /^(?:tt\d{5,12}|tmdb:(?:movie:)?[1-9]\d{0,11})$/;

function movieVectorPath(id) {
  if (typeof id !== 'string' || !MOVIE_ID.test(id)) return null;
  return '/design-meta/art/movie/' + id + '/landscape.svg';
}

function movieVectorCachePath(url) {
  if (url.searchParams.get('v') !== FILM_DETAILS_PROFILE) return null;
  const match = /^\/design-meta\/art\/movie\/([^/]+)\/landscape\.svg$/.exec(url.pathname);
  if (!match) return null;
  try {
    return movieVectorPath(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

module.exports = { FILM_DETAILS_PROFILE, MOVIE_VECTOR_TTL, MOVIE_VECTOR_GRACE,
  movieVectorPath, movieVectorCachePath };
