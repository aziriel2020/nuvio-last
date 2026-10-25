'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const suites = [
  { name: 'Worldwide movies France', cwd: root, args: ['--test', 'regions/movies/test/movies.test.cjs'] },
  { name: 'Worldwide live-action series', cwd: root, args: ['--test', 'regions/series/test/series.test.cjs'] },
  { name: 'USA engine', cwd: path.join(root, 'regions', 'us'), args: ['--test'] },
  { name: 'France engine', cwd: path.join(root, 'regions', 'fr'), args: ['--test'] },
  { name: 'Türkiye engine', cwd: path.join(root, 'regions', 'tr'), args: ['--test'] },
  { name: 'Global VOD engine', cwd: path.join(root, 'regions', 'global'), args: ['--test'] },
  { name: 'Coexistence wrapper', cwd: root, args: ['--test', 'test/coexist.test.js'] },
  { name: 'Production audit helpers', cwd: root, args: ['--test', 'test/audit.test.mjs'] },
  { name: 'Artwork recovery and persistent cache', cwd: root, args: ['--test', 'test/artwork-runtime.test.mjs'] },
  { name: 'Oracle Always Free guardrails', cwd: root, args: ['--test', 'test/oracle-config.test.mjs'] }
];

for (const suite of suites) {
  console.log(`\n=== ${suite.name} ===`);
  const result = spawnSync(process.execPath, suite.args, { cwd: suite.cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll France + Türkiye + Global VOD + USA coexistence + audit + Oracle guardrail suites passed.');
