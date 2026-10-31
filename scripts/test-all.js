'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const suites = [
  { name: 'Cross-region movie streaming release recovery', cwd: root, args: ['--test', 'test/streaming-release-recovery.test.cjs'] },
  { name: 'Verified premiere coverage and mandatory cards', cwd: root, args: ['--test', 'test/premiere-coverage.test.mjs'] },
  { name: 'Worldwide movies France', cwd: root, args: ['--test', 'regions/movies/test/movies.test.cjs', 'regions/movies/test/catalog-policy.test.cjs'] },
  { name: 'Worldwide live-action series', cwd: root, args: ['--test', 'regions/series/test/series.test.cjs', 'regions/series/test/catalog-policy.test.cjs'] },
  { name: 'Live Series freshness monitor', cwd: root, args: ['--test', 'test/series-freshness.test.mjs'] },
  { name: 'USA engine', cwd: path.join(root, 'regions', 'us'), args: ['--test'] },
  { name: 'France engine', cwd: path.join(root, 'regions', 'fr'), args: ['--test'] },
  { name: 'Türkiye engine', cwd: path.join(root, 'regions', 'tr'), args: ['--test'] },
  { name: 'Global VOD engine', cwd: path.join(root, 'regions', 'global'), args: ['--test'] },
  { name: 'Coexistence wrapper', cwd: root, args: ['--test', 'test/coexist.test.js'] },
  { name: 'TV collection-only catalogs', cwd: root, args: ['--test', 'test/collections-only.test.js'] },
  { name: 'Mobile Desktop collection-only Home performance', cwd: root, args: ['--test', 'test/mobile-desktop-collections.test.js'] },
  { name: 'Mobile collection period tabs and reduced visible posters', cwd: root, args: ['--test', 'test/mobile-period-tabs.test.js'] },
  { name: 'Native Bridge original artwork and opt-in manifests', cwd: root, args: ['--test', 'test/native-bridge.test.cjs'] },
  { name: 'Production audit helpers', cwd: root, args: ['--test', 'test/audit.test.mjs'] },
  { name: 'Artwork recovery and persistent cache', cwd: root, args: ['--test', 'test/artwork-runtime.test.mjs'] },
  { name: 'Concurrent Shield artwork request deduplication', cwd: root, args: ['--test', 'test/shield-poster-singleflight.test.mjs'] },
  { name: 'Films Monde poster/cache performance regression', cwd: root, args: ['--test', 'test/films-monde-posters.test.mjs'] },
  { name: 'Films Monde fast archives, period parity and preserved design', cwd: root, args: ['--test', 'test/films-monde-fast-collections.test.cjs'] },
  { name: 'Oracle Always Free guardrails', cwd: root, args: ['--test', 'test/oracle-config.test.mjs'] }
];

for (const suite of suites) {
  console.log(`\n=== ${suite.name} ===`);
  const result = spawnSync(process.execPath, suite.args, { cwd: suite.cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll France + Türkiye + Global VOD + USA coexistence + audit + Oracle guardrail suites passed.');
