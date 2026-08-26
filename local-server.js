'use strict';
const http = require('node:http');
const handler = require('./api/index');
const port = Number(process.env.PORT || 8787);
const server = http.createServer((req, res) => Promise.resolve(handler(req, res)).catch((error) => {
  console.error(error);
  if (!res.headersSent) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
  }
  res.end(JSON.stringify({ error: error?.message || 'Internal error' }));
}));
server.listen(port, () => console.log(`USA+FR coexist server: http://localhost:${port}`));
