'use strict';

const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function aliasPlugin() {
  const aliases = new Map([
    ['sharp', path.join(ROOT, 'cloudflare/stubs/sharp.cjs')],
    ['opentype.js', path.join(ROOT, 'cloudflare/stubs/opentype.cjs')],
    ['fs', path.join(ROOT, 'cloudflare/stubs/fs.cjs')],
    ['node:fs', path.join(ROOT, 'cloudflare/stubs/fs.cjs')],
    ['path', path.join(ROOT, 'cloudflare/stubs/path.cjs')],
    ['node:path', path.join(ROOT, 'cloudflare/stubs/path.cjs')]
  ]);

  return {
    name: 'nuvio-cloudflare-runtime-aliases',
    setup(build) {
      build.onResolve({ filter: /^(sharp|opentype\.js|fs|node:fs|path|node:path)$/ }, (args) => ({
        path: aliases.get(args.path)
      }));
      build.onResolve({ filter: /cloudflare-secret-migration$/ }, () => ({
        path: path.join(ROOT, 'cloudflare/stubs/cloudflare-secret-migration.cjs')
      }));
    }
  };
}

async function buildWorker(options = {}) {
  const dist = options.dist || path.join(ROOT, 'dist');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'cloudflare/worker.mjs')],
    outfile: path.join(dist, '_worker.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    minify: true,
    legalComments: 'none',
    define: {
      __dirname: JSON.stringify('/')
    },
    plugins: [aliasPlugin()],
    logLevel: 'info'
  });
}

if (require.main === module) {
  buildWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildWorker };
