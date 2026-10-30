#!/usr/bin/env node
// Fast, exhaustive structural inventory: every collection, folder and catalog
// reference across all regional manifests. Does not claim to have fetched the
// content of each dynamic catalog; that is a separate, slower audit.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGIN = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const REGIONS = ['fr', 'us', 'tr', 'global'];
const REPORT = process.env.AUDIT_INVENTORY_REPORT || 'audit-collection-inventory.json';

async function getJson(route) {
  const url = new URL(route, ORIGIN);
  let error;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'cache-control': 'no-cache',
          'user-agent': 'NuvioAllCollectionInventory/1.0' }
      });
      if (!response.ok) throw Error(route + ' HTTP ' + response.status);
      if (response.headers.get('x-nuvio-origin') !== 'oracle-vm')
        throw Error(route + ' not served by Oracle');
      if (response.headers.get('x-nuvio-upstream-error') === '1')
        throw Error(route + ' upstream-error flag');
      return await response.json();
    } catch (cause) {
      error = cause;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    } finally { clearTimeout(timer); }
  }
  throw error;
}
export function inventory(region, collections, manifest) {
  const errors = [];
  if (!Array.isArray(collections)) throw Error(region + ': invalid collections array');
  if (!Array.isArray(manifest?.catalogs)) throw Error(region + ': invalid manifest catalogs');
  const manifestKeys = new Set();
  for (const entry of manifest.catalogs) {
    if (!entry?.id || !['movie', 'series'].includes(entry.type)) continue;
    const key = entry.type + ':' + entry.id;
    if (manifestKeys.has(key)) errors.push('Duplicate manifest catalog ' + key);
    manifestKeys.add(key);
  }
  const linked = new Set();
  const categoryStats = [];
  let folders = 0, references = 0;
  for (const collection of collections) {
    if (!collection || !Array.isArray(collection.folders))
      { errors.push('Missing folders in collection ' + String(collection?.title || collection?.id)); continue; }
    let categoryRefs = 0;
    for (const folder of collection.folders) {
      folders++;
      if (!Array.isArray(folder.sources))
        { errors.push('Missing sources in folder ' + String(folder?.title || folder?.id)); continue; }
      const seenInFolder = new Set();
      for (const source of folder.sources) {
        if (!source || !['movie', 'series'].includes(source.type) || !source.catalogId) {
          errors.push('Invalid source in ' + String(folder.title || folder.id)); continue;
        }
        references++; categoryRefs++;
        const key = source.type + ':' + source.catalogId;
        if (seenInFolder.has(key)) errors.push('Repeated source in folder ' + key);
        seenInFolder.add(key);
        linked.add(key);
        if (!manifestKeys.has(key))
          errors.push('Missing catalog in manifest ' + region + '/' + key);
      }
    }
    categoryStats.push({ name: String(collection.title || collection.id || 'Untitled'),
      folders: collection.folders.length, references: categoryRefs });
  }
  if (!collections.length || !references || !manifestKeys.size)
    errors.push(region + ': empty collection/catalog inventory');
  const unlinked = [...manifestKeys].filter(key => !linked.has(key));
  return {
    region, collections: collections.length, folders, references,
    uniqueCatalogsLinked: linked.size, catalogsInManifest: manifestKeys.size,
    unlinkedManifestCatalogs: unlinked.length,
    categoryStats, errors
  };
}
export async function run(fetchJson = getJson) {
  const startedAt = new Date().toISOString(), results = [];
  for (const region of REGIONS) {
    try {
      const collections = await fetchJson('/' + region + '/nuvio-collections.json');
      const manifest = await fetchJson('/' + region + '/manifest.json');
      const result = inventory(region, collections, manifest);
      results.push(result);
      console.log('[INVENTORY] ' + region.toUpperCase() + ' collections=' +
        result.collections + ' folders=' + result.folders + ' linked=' +
        result.uniqueCatalogsLinked + ' failures=' + result.errors.length);
    } catch (error) {
      results.push({ region, errors: [String(error?.message || error)] });
      console.error('[INVENTORY FAIL] ' + region + ' ' + error.message);
    }
  }
  const report = { startedAt, finishedAt: new Date().toISOString(), origin: ORIGIN,
    scope: 'All collection/folder/catalog references; not dynamic catalog content',
    results, passed: results.every(result => !result.errors.length) };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed,
    summary: results.map(r => ({ region:r.region, collections:r.collections || 0,
      linked:r.uniqueCatalogsLinked || 0, failures:r.errors.length,
      firstErrors:r.errors.slice(0, 12) })) }, null, 2));
  return report;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().then(r => { if (!r.passed) process.exitCode = 1; })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
