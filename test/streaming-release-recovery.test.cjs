'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const recovery = require('../runtime/streaming-release-recovery.cjs');
const calendar = {
  fr: require('../regions/fr/src/calendar.js'),
  us: require('../regions/us/src/calendar.js'),
  tr: require('../regions/tr/src/calendar.js'),
  global: require('../regions/global/src/calendar.js')
};
const sample = {
  id: 987654,
  title: 'Original platform film',
  release_date: '2026-10-30',
  external_ids: { imdb_id: 'tt98765432' },
  release_dates: { results: [] }
};
const w = { start:'2026-10-30',end:'2026-10-30',today:'2026-10-30',allowPast:true,empty:false };
test('secondary scan preserves platform constraints and uses original date, not cinema type 4', () => {
  const p=recovery.secondaryMovieDiscoveryParams({
    region:'FR',watch_region:'FR',with_watch_providers:'8|9',
    with_watch_monetization_types:'flatrate','release_date.gte':w.start,
    'release_date.lte':w.end,with_release_type:'4',language:'fr-FR'
  },w);
  assert.equal(p['primary_release_date.gte'],w.start);
  assert.equal(p['primary_release_date.lte'],w.end);
  assert.equal(p.with_watch_providers,'8|9');
  assert.equal(p.watch_region,'FR');
  assert.equal(p.with_release_type,undefined);
  assert.equal(p.region,undefined);
});
test('movie recovery rejects old theatrical originals and known regional digital dates', () => {
  assert.equal(recovery.originalPremiereWhenDigitalMissing({...sample,release_date:'2026-10-09'},w,'FR'),null);
  assert.equal(recovery.originalPremiereWhenDigitalMissing({...sample,
    release_dates:{results:[{iso_3166_1:'FR',release_dates:[{type:4,release_date:'2026-11-01T00:00:00Z'}]}]}
  },w,'FR'),null);
  assert.equal(recovery.originalPremiereWhenDigitalMissing({...sample,
    release_dates:{results:[{iso_3166_1:'US',release_dates:[{type:4,release_date:'2026-11-01T00:00:00Z'}]}]}
  },w,null),null);
  assert.equal(recovery.originalPremiereWhenDigitalMissing({...sample,
    release_dates:{results:[{iso_3166_1:'US',release_dates:[{type:4,release_date:'2026-11-01T00:00:00Z'}]}]}
  },w,'FR').date,w.start);
});
test('recovered candidate IDs are canonical, bounded and do not duplicate original results', () => {
  assert.deepEqual(recovery.mergeCandidatePages([{id:1},{id:2}],[{id:2},{id:3},{id:0}],5).map(x=>x.id),[1,2,3]);
  assert.deepEqual(recovery.mergeCandidatePages([{id:1}],[{id:2},{id:3}],2).map(x=>x.id),[1,2]);
});
for (const [region, mod] of Object.entries(calendar)) {
  test(region + ' rejects inferred movie dates without exact provider confirmation', () => {
    const bare=mod.movieDetailsToMeta(sample,'Test platform',w);
    assert.equal(bare.meta,null);
    const confirmed=mod.movieDetailsToMeta(sample,'Test platform',w,{providerConfirmed:true});
    assert.equal(confirmed.meta?.released,'2026-10-30');
    assert.equal(confirmed.recovered,true);
    assert.match(confirmed.meta.description,/date de lancement streaming inconnue/);
    assert.equal(mod.movieVodDetailsToMeta(sample,'VOD',w).meta,null);
  });
  test(region + ' preserves strict TMDb digital release even when original date differs', () => {
    const market=region==='global'?'US':region.toUpperCase();
    const detail={...sample,release_date:'2026-10-09',
      release_dates:{results:[{iso_3166_1:market,release_dates:[{type:4,release_date:'2026-10-30T00:00:00.000Z'}]}]}};
    const result=mod.movieDetailsToMeta(detail,'Test platform',w,{providerConfirmed:true});
    assert.equal(result.meta?.released,'2026-10-30');
    assert.equal(result.recovered,false);
  });
}
