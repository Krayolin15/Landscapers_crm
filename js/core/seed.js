/* =============================================================================
   Company data pack loader (local mode).

   data/seed/manifest.json lists every collection file with its record count and
   a checksum. On first run everything is loaded; when a newer data pack ships,
   only records that nobody has touched since import are refreshed and new ones
   added — anything a person edited is never overwritten.
   In Supabase mode the same data is loaded by 06_seed.sql from the private data pack instead.
   ========================================================================== */

import { db } from './db.js';
import { idb } from './idb.js';

const SYSTEM = { id: 'system', name: 'Company records import' };

export async function loadManifest() {
  const res = await fetch('data/seed/manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('The company data pack is not installed. Unzip landscapers-inc-PRIVATE-data.zip into this app’s data/seed folder and reload (README → “Try it on one computer”).');
  return res.json();
}

/** First run or upgrade. onProgress({ done, total, collection, count }) */
export async function ensureSeed(onProgress = () => {}) {
  const manifest = await loadManifest();
  const current = await idb.kvGet('seed.version');
  if (current === manifest.version) return { loaded: false, version: current };
  const firstRun = !current;
  let done = 0;
  const total = manifest.collections.length;
  const summary = [];
  for (const c of manifest.collections) {
    onProgress({ done, total, collection: c.label || c.name, count: c.count });
    const res = await fetch(`data/seed/${c.file}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Missing data file data/seed/${c.file}`);
    const rows = await res.json();
    let toWrite = rows;
    if (!firstRun) {
      toWrite = rows.filter(r => {
        const existing = db.get(c.name, r.id);
        return !existing || (existing._seed && existing.updated_by === SYSTEM.id);
      });
    }
    const stamped = toWrite.map(r => ({ ...r, _seed: true, created_by: r.created_by || SYSTEM.id, created_by_name: r.created_by_name || SYSTEM.name, updated_by: SYSTEM.id, updated_by_name: SYSTEM.name }));
    if (stamped.length) await db.bulkUpsert(c.name, stamped, { silent: true, as: SYSTEM, localOnly: true });
    summary.push({ collection: c.name, total: rows.length, written: stamped.length });
    done++;
  }
  onProgress({ done: total, total, collection: 'Finishing', count: 0 });
  await idb.kvSet('seed.version', manifest.version);
  await idb.kvSet('seed.summary', { version: manifest.version, at: new Date().toISOString(), firstRun, summary });
  return { loaded: true, firstRun, version: manifest.version, summary };
}
