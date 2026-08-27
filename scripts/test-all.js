'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const suites = [
  { name: 'USA engine', cwd: path.join(root, 'regions', 'us'), args: ['--test'] },
  { name: 'France engine', cwd: path.join(root, 'regions', 'fr'), args: ['--test'] },
  { name: 'Global VOD engine', cwd: path.join(root, 'regions', 'global'), args: ['--test'] },
  { name: 'Coexistence wrapper', cwd: root, args: ['--test', 'test/coexist.test.js'] }
];

for (const suite of suites) {
  console.log(`\n=== ${suite.name} ===`);
  const result = spawnSync(process.execPath, suite.args, { cwd: suite.cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll France + Global VOD + USA coexistence suites passed.');
