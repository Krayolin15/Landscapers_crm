// Build the company data pack from the extracted knowledge:
//   node tools/build-seed.mjs [--knowledge <dir>] [--out <dir>] [--strict]
//
// 1. runs every mapper in tools/seed/*.mjs  (each: export async function build(ctx) -> { <collection>: [records] })
// 2. merges records by id (later mappers may enrich earlier ones via ctx.patch)
// 3. validates EVERY record against the app schema (js/schema/*.js) — the same rules the app enforces
// 4. checks every reference (ref / refs fields) points at an existing record
// 5. writes <out>/<collection>.json, <out>/manifest.json, <out>/validation-report.json
//    and <out>/06_seed.sql (for Supabase — company data stays in the private data pack)
// Exit code 1 when any record fails validation or a reference is broken (unless it is a declared softRef).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { SCHEMA, SYSTEM_FIELDS } from '../js/core/schema.js';
import { validateRecord, normalise } from '../js/core/validate.js';
import { ident } from './sql-ident.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const KNOW = resolve(arg('--knowledge', process.env.LSI_KNOWLEDGE || join(root, '..', 'knowledge')));
const OUT = resolve(arg('--out', join(root, 'data', 'seed')));
const STRICT = process.argv.includes('--strict');
const SKIP_BROKEN = process.argv.includes('--skip-broken');

// ---------------------------------------------------------------- context for mappers
const cache = new Map();
const ctx = {
  root, KNOW,
  /** Load knowledge/<group>.json */
  k(group) {
    if (!cache.has(group)) {
      const p = join(KNOW, `${group}.json`);
      if (!existsSync(p)) throw new Error(`knowledge file missing: ${p}`);
      cache.set(group, JSON.parse(readFileSync(p, 'utf8')));
    }
    return cache.get(group);
  },
  has(group) { return existsSync(join(KNOW, `${group}.json`)); },
  /** Deterministic id from a prefix + natural key(s), so references are stable across rebuilds. */
  id(prefix, ...parts) {
    const key = parts.map(p => String(p ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return `${prefix}-${slug || 'x'}-${createHash('sha1').update(key).digest('hex').slice(0, 6)}`;
  },
  trim: s => (s == null ? s : String(s).replace(/\s+/g, ' ').trim()),
  /** SA phone normaliser -> '0821234567' or original digits. */
  phone(s) {
    if (s == null || s === '') return null;
    let d = String(s).replace(/[^\d+]/g, '');
    if (d.startsWith('+27')) d = '0' + d.slice(3);
    else if (d.startsWith('27') && d.length === 11) d = '0' + d.slice(2);
    else if (/^[1-9]\d{8}$/.test(d)) d = '0' + d; // leading zero lost in a spreadsheet
    return d || null;
  },
  money(v) { if (v == null || v === '' || v === 'N/A' || v === 'NA') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[R\s,]/g, '')); return Number.isFinite(n) ? n : null; },
  iso(v) { if (!v) return null; const s = String(v); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; },
  records: {},
  patches: [],
  /** Enrich a record another mapper produced: ctx.patch('clients', id, {field: value}) */
  patch(col, id, fields) { ctx.patches.push({ col, id, fields }); },
  notes: []
};

// ---------------------------------------------------------------- run mappers
const mapDir = join(root, 'tools', 'seed');
const mappers = existsSync(mapDir) ? readdirSync(mapDir).filter(f => /^\d\d-.*\.mjs$/.test(f)).sort() : [];
if (!mappers.length) { console.error('No mappers in tools/seed/'); process.exit(1); }
for (const f of mappers) {
  let out;
  try {
    const mod = await import(pathToFileURL(join(mapDir, f)).href);
    out = await mod.build(ctx);
  } catch (e) {
    // --skip-broken: keep going so one mapper under edit doesn't block checking the others
    if (!SKIP_BROKEN) throw e;
    console.log(`✗ ${f} SKIPPED: ${e.message}`);
    continue;
  }
  let n = 0;
  for (const [col, rows] of Object.entries(out || {})) {
    if (!SCHEMA[col]) throw new Error(`${f}: unknown collection "${col}"`);
    const m = (ctx.records[col] = ctx.records[col] || new Map());
    for (const r of rows) {
      if (!r.id) throw new Error(`${f}: record without id in ${col}: ${JSON.stringify(r).slice(0, 200)}`);
      if (m.has(r.id)) {
        const prev = m.get(r.id);
        m.set(r.id, { ...prev, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined && v !== '')), _src: [prev._src, r._src].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' ; ') });
      } else m.set(r.id, r);
      n++;
    }
  }
  console.log(`✓ ${f}: ${n} records`);
}
for (const p of ctx.patches) {
  const m = ctx.records[p.col];
  if (!m || !m.has(p.id)) { ctx.notes.push(`patch target missing ${p.col}/${p.id}`); continue; }
  m.set(p.id, { ...m.get(p.id), ...p.fields });
}

// ---------------------------------------------------------------- validate
const report = { built_at: new Date().toISOString(), knowledge: KNOW, collections: {}, errors: [], warnings: [], broken_refs: [], notes: ctx.notes };
const finalRecords = {};
const lookup = (c, id) => (ctx.records[c] && ctx.records[c].get(String(id))) || null;
for (const [col, m] of Object.entries(ctx.records)) {
  const def = SCHEMA[col];
  const all = Array.from(m.values());
  const clean = [];
  for (let rec of all) {
    rec = normalise(def, rec);
    // unknown fields are allowed (stored in `data`), but system fields must be well-formed
    const res = validateRecord(def, rec, { existing: all, lookup, id: rec.id });
    for (const [field, msg] of Object.entries(res.errors)) report.errors.push({ collection: col, id: rec.id, field, message: msg, value: rec[field] ?? null, _src: rec._src || null });
    for (const [field, msg] of Object.entries(res.warnings)) report.warnings.push({ collection: col, id: rec.id, field, message: msg });
    for (const [fname, f] of Object.entries(def.fields)) {
      if (f.type === 'ref' && rec[fname] && !lookup(f.ref, rec[fname])) report.broken_refs.push({ collection: col, id: rec.id, field: fname, ref: f.ref, value: rec[fname], soft: !!f.softRef });
      if (f.type === 'refs' && Array.isArray(rec[fname])) for (const v of rec[fname]) if (!lookup(f.ref, v)) report.broken_refs.push({ collection: col, id: rec.id, field: fname, ref: f.ref, value: v, soft: !!f.softRef });
    }
    if (!rec._src && !rec._generated) report.warnings.push({ collection: col, id: rec.id, field: '_src', message: 'record has no source provenance' });
    clean.push({ ...rec, _seed: true });
  }
  report.collections[col] = clean.length;
  finalRecords[col] = clean;
}

// ---------------------------------------------------------------- write
mkdirSync(OUT, { recursive: true });
const manifest = { version: '', built_at: report.built_at, collections: [] };
const hash = createHash('sha1');
for (const [col, rows] of Object.entries(finalRecords).sort()) {
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const json = JSON.stringify(rows);
  hash.update(col + json);
  writeFileSync(join(OUT, `${col}.json`), json);
  manifest.collections.push({ name: col, file: `${col}.json`, count: rows.length, label: SCHEMA[col].label });
}
manifest.version = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
writeFileSync(join(OUT, 'validation-report.json'), JSON.stringify(report, null, 1));

// Supabase seed SQL: typed columns + everything else into `data`
const sqlVal = v => (v === null || v === undefined ? 'null' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'null') : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
let sql = `-- Landscapers Inc. HQ — company data seed (GENERATED by tools/build-seed.mjs, version ${manifest.version})\n-- Run AFTER 01–05. Safe to re-run: existing ids are updated only while they are still untouched seed rows.\nbegin;\n` +
  // skip attribution/audit triggers during the bulk load; if the project does not allow it the load still works
  // (the attribution trigger keeps the imported created_by values when there is no signed-in user)
  `do $$ begin set local session_replication_role = replica; exception when others then raise notice 'triggers stay on during the seed load: %', sqlerrm; end $$;\n`;
// Local-mode password fields never go to Supabase: logins there are Supabase Auth accounts (see sql/08_link_accounts.sql),
// and every signed-in user can read profiles.
const SUPABASE_OMIT = { profiles: new Set(['password_hash', 'password_salt']) };
for (const [col, rows] of Object.entries(finalRecords).sort()) {
  const def = SCHEMA[col];
  const cols = new Set([...SYSTEM_FIELDS, ...Object.keys(def.fields).filter(k => !def.fields[k].computed)]);
  const omit = SUPABASE_OMIT[col] || new Set();
  for (const r of rows) {
    const known = {}, data = {};
    for (const [k, v] of Object.entries(r)) { if (omit.has(k)) continue; (cols.has(k) ? (known[k] = v) : (data[k] = v)); }
    const keys = Object.keys(known);
    const vals = keys.map(k => {
      const f = def.fields[k];
      const v = known[k];
      if (f && ['json', 'refs', 'tags', 'multi', 'files'].includes(f.type)) return v == null ? 'null' : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
      if (v !== null && typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
      return sqlVal(v);
    });
    keys.push('data'); vals.push(`'${JSON.stringify(data).replace(/'/g, "''")}'::jsonb`);
    sql += `insert into public.${ident(col)} (${keys.map(ident).join(', ')}) values (${vals.join(', ')}) on conflict (id) do update set ${keys.filter(k => k !== 'id').map(k => `${ident(k)} = excluded.${ident(k)}`).join(', ')} where public.${ident(col)}._seed and public.${ident(col)}.updated_by is not distinct from public.${ident(col)}.created_by;\n`;
  }
}
sql += `commit;\n-- Verification\nselect '${manifest.version}' as seed_version${Object.entries(finalRecords).sort().map(([c, rows]) => `, (select count(*) from public.${ident(c)} where _seed) = ${rows.length} as ${c}_ok`).join('')};\n`;
// The seed SQL contains company data, so it lives WITH the data pack (never in the app's sql/ folder).
writeFileSync(join(OUT, '06_seed.sql'), sql);

const hardBroken = report.broken_refs.filter(b => !b.soft);
console.log(`\nData pack ${manifest.version}: ${Object.values(report.collections).reduce((a, b) => a + b, 0)} records in ${Object.keys(report.collections).length} collections`);
console.log(`validation errors: ${report.errors.length} · warnings: ${report.warnings.length} · broken refs: ${hardBroken.length} hard / ${report.broken_refs.length - hardBroken.length} soft`);
if (report.errors.length) console.log(report.errors.slice(0, 25).map(e => `  ✗ ${e.collection}/${e.id} ${e.field}: ${e.message}`).join('\n'));
if (hardBroken.length) console.log(hardBroken.slice(0, 25).map(e => `  ✗ ${e.collection}/${e.id} ${e.field} -> ${e.ref}/${e.value}`).join('\n'));
process.exit(report.errors.length || hardBroken.length || (STRICT && report.broken_refs.length) ? 1 : 0);
