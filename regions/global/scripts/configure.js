'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.resolve(process.cwd(), '.env.local');

function normalizeSecret(value) {
  const secret = String(value || '').trim();
  if (!secret || /\s/.test(secret)) return null;
  return secret;
}

function writeSecret(name, value) {
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const re = new RegExp(`^\\s*${name}\\s*=`);
  const lines = current.split(/\r?\n/).filter((line) => !re.test(line));
  lines.push(`${name}=${value}`);
  const content = `${lines.filter(Boolean).join('\n')}\n`;
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  try { fs.chmodSync(envPath, 0o600); } catch {}
  console.log(`${name} enregistré dans .env.local (fichier ignoré par Git).`);
}

const envToken = normalizeSecret(process.env.TMDB_READ_TOKEN);
const envKey = normalizeSecret(process.env.TMDB_API_KEY);
if (envToken) {
  writeSecret('TMDB_READ_TOKEN', envToken);
  process.exit(0);
}
if (envKey) {
  writeSecret('TMDB_API_KEY', envKey);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    const secret = normalizeSecret(input);
    if (!secret) {
      console.error('Secret TMDb invalide ou vide.');
      process.exit(1);
    }
    const name = secret.length > 64 ? 'TMDB_READ_TOKEN' : 'TMDB_API_KEY';
    writeSecret(name, secret);
  });
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Colle ton TMDb API Read Access Token (recommandé) ou ta clé v3 : ', (answer) => {
    rl.close();
    const secret = normalizeSecret(answer);
    if (!secret) {
      console.error('Secret TMDb invalide ou vide.');
      process.exit(1);
    }
    const name = secret.length > 64 ? 'TMDB_READ_TOKEN' : 'TMDB_API_KEY';
    writeSecret(name, secret);
  });
}
