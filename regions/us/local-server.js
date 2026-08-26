'use strict';

require('./src/env').loadEnvFile();

const http = require('http');
const handler = require('./api/index');
const port = Number(process.env.PORT || 7000);

http.createServer((req, res) => handler(req, res)).listen(port, '0.0.0.0', () => {
  console.log(`Nuvio Calendar Archives: http://localhost:${port}/manifest.json`);
});
