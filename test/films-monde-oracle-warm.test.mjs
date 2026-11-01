import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {catalogIds,sameArtworkUrl} from '../scripts/warm-films-monde-artwork.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

test('warm-up loads existing dynamic, monthly and grouped annual catalog IDs',()=>{
 const now=new Date('2026-11-01T11:00:00Z');
 const one=catalogIds(now,0),other=catalogIds(now,1);
 assert(one.includes('movies-fr-all-all-today'));
 assert(one.includes('movies-fr-cinema-all-yesterday'));
 assert(one.includes('movies-fr-streaming-all-2026-11'));
 assert(one.every(x=>/^movies-fr-(all|streaming|vod|cinema)-(all|\d+|standup)-(today|yesterday|2026-11|annual-2026|annual-2025)$/.test(x)), 'only existing manifest catalog IDs');
 assert(one.includes('movies-fr-all-all-annual-2025'));
 assert(one.includes('movies-fr-streaming-all-annual-2026'));
 assert(one.length<65,'bounded genre rotation');
 assert.notDeepEqual(one,other,'each interval warms other genres');
});
test('poster warmer cannot contact Vercel, a third-party URL, or the wrong art profile',()=>{
 const original='https://141-145-215-202.nip.io/fr/calendar-card.jpg?layout=landscape&type=movie&world=1&v=fast-artwork-v3&src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw780%2Fabc.jpg';
 const rewritten=sameArtworkUrl(original);
 assert.equal(rewritten,'http://127.0.0.1:3000'+new URL(original).pathname+new URL(original).search);
 for(const url of [
  'https://example.vercel.app/fr/calendar-card.jpg?world=1&layout=landscape&type=movie',
  'https://image.tmdb.org/t/p/w780/a.jpg',
  'https://141-145-215-202.nip.io/fr/calendar-card.jpg?world=0&layout=landscape&type=movie',
  'https://141-145-215-202.nip.io/fr/calendar-card.jpg?world=1&layout=portrait&type=movie',
  'https://141-145-215-202.nip.io/fr/calendar-card.jpg?world=1&layout=landscape&type=series'
 ])assert.equal(sameArtworkUrl(url),null,url);
});
test('systemd is limited, Oracle-only and separated from catalog sync and APK',()=>{
 const service=readFileSync(resolve(root,'oracle/nuvio-movies-warm.service'),'utf8');
 const timer=readFileSync(resolve(root,'oracle/nuvio-movies-warm.timer'),'utf8');
 const updater=readFileSync(resolve(root,'oracle/update.sh'),'utf8');
 assert.match(service,/CPUQuota=15%/);
 assert.match(service,/MemoryMax=192M/);
 assert.match(service,/scripts\/warm-films-monde-artwork\.mjs/);
 assert.match(timer,/OnUnitActiveSec=12min/);
 assert.match(updater,/systemctl start nuvio-movies-warm.timer/);
 assert.doesNotMatch(service,/vercel|pages\.dev|worker|npm run build/i);
});
