'use strict';

const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const values = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadEnvFile(filePath = path.resolve(process.cwd(), '.env.local')) {
  if (!fs.existsSync(filePath)) return false;
  const parsed = parseEnv(fs.readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

module.exports = { parseEnv, loadEnvFile };
