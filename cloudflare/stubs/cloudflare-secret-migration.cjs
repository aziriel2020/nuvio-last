'use strict';

module.exports = async function cloudflareMigrationUnavailable(req, res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: 'Not found' }));
};
