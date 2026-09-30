// The Document Vault: the company's 8 shared drives (as on Google Drive), their folders, and one file record
// for EVERY original company document (239 unique files). Each file is linked to the records that were
// transcribed from it, carries its searchable text, confidentiality and expiry. The bytes are attached later
// by importing the vault zip in Drive (#/drive/import) — until then the file shows as "pending import".
// Sources: <scratchpad>/vault-index.json (tools/vault_index.py), groups.json + text dumps, all mapped records.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const DRIVES = [
  { id: 'drive-admin', name: 'ADMIN', color: '#6b7a70', icon: 'folder-cog' },
  { id: 'drive-finance', name: 'FINANCE', color: '#1f7440', icon: 'landmark', restricted: true, roles: ['finance'] },
  { id: 'drive-hr', name: 'HR', color: '#de8d4f', icon: 'id-card', restricted: true, roles: ['hr'] },
  { id: 'drive-legal', name: 'LEGAL AND COMPLIANCE', color: '#e0525e', icon: 'scale' },
  { id: 'drive-management', name: 'MANAGEMENT', color: '#7b61ff', icon: 'mountain' },
  { id: 'drive-operations', name: 'OPERATIONS', color: '#1e9bc4', icon: 'route' },
  { id: 'drive-sales', name: 'SALES', color: '#f2b42f', icon: 'target' },
  { id: 'drive-sops', name: "SOP'S & TEMPLATES", color: '#5fa83b', icon: 'book-open' }
];
const GROUP = {
  company_compliance: ['drive-legal', 'Company documents'], crm_workbooks: ['drive-sales', 'CRM workbooks'], financials: ['drive-finance', 'Income statements'],
  invoices_apr_may: ['drive-finance', 'Invoices'], invoices_june: ['drive-finance', 'Invoices'], invoices_july: ['drive-finance', 'Invoices'],
  kpi_trackers: ['drive-management', 'KPI trackers'], strategy_roles: ['drive-management', 'Strategy & roles'], schedule_ops_registers: ['drive-operations', 'Schedules & registers'],
  projects_fleet_purchases: ['drive-operations', 'Fleet & projects'], people_hr: ['drive-hr', 'Employees'], medicals: ['drive-hr', 'Medicals'],
  training_firstaid: ['drive-hr', 'Training material'], training_heights: ['drive-hr', 'Training material'], training_firefighting_hsrep: ['drive-hr', 'Training material'],
  hs_policies_procedures: ['drive-sops', 'H&S'], hs_forms_checklists_loa: ['drive-sops', 'H&S'], sops_toolbox: ['drive-sops', 'SOPs'],
  sales_leads: ['drive-sales', 'Sales portfolio'], marketing_options: ['drive-sales', 'Marketing & design options']
};
const STAMP = /-20\d{6}T\d{6}Z-\d-\d{3}$/;
const CONFIDENTIAL = /medical|employee index|ex_?employee|employees\/|contracts employees|director id|\bid\b|payroll|income statement|bank|certified/i;
const pathKey = p => { const parts = String(p).replace(/\\/g, '/').split('/').map(s => s.trim().toLowerCase()).filter(Boolean); return parts.slice(-2).join('|'); };

/** original folders after the timestamped download folder, with the repeated top name collapsed. */
export function folderParts(src) {
  const parts = src.replace(/\\/g, '/').split('/').slice(1, -1).map(s => s.trim()).filter(Boolean);
  if (parts.length && STAMP.test(parts[0])) parts[0] = parts[0].replace(STAMP, '').trim();
  if (parts.length > 1 && parts[0].toLowerCase() === parts[1].toLowerCase()) parts.shift();
  return parts;
}

export async function build(ctx) {
  const SP = dirname(ctx.KNOW);
  const idxPath = join(SP, 'vault-index.json');
  if (!existsSync(idxPath)) { ctx.notes.push('vault-index.json missing — run tools/vault_index.py first; no vault records built'); return {}; }
  const index = JSON.parse(readFileSync(idxPath, 'utf8'));
  const groups = existsSync(join(SP, 'groups.json')) ? JSON.parse(readFileSync(join(SP, 'groups.json'), 'utf8')).groups : [];
  const txtBySrc = new Map(groups.flatMap(g => g.files.map(f => [pathKey(f.src), f.txt])));

  // which records came from which file (via _src provenance)
  const linkedBy = new Map();
  for (const [col, m] of Object.entries(ctx.records)) for (const r of m.values()) {
    for (const part of String(r._src || '').split(/\s;\s/)) {
      const p = part.split(' | ')[0].trim();
      if (!/\.(pdf|xlsx|docx|pptx|jpe?g|png|md)$/i.test(p)) continue;
      const k = pathKey(p);
      if (!linkedBy.has(k)) linkedBy.set(k, []);
      const arr = linkedBy.get(k);
      if (!arr.some(x => x.collection === col && x.id === r.id) && arr.length < 400) arr.push({ collection: col, id: r.id });
    }
  }
  const expiryOf = links => {
    const dates = links.map(l => { const r = ctx.records[l.collection] && ctx.records[l.collection].get(l.id); return r && (r.expiry_date || r.licence_expiry); }).filter(Boolean).sort();
    return dates[0] || null;
  };

  const out = { drives: [], folders: [], files: [] };
  for (const d of DRIVES) out.drives.push({ id: d.id, name: d.name, color: d.color, icon: d.icon, restricted: !!d.restricted, roles: d.roles || [],
    members: d.restricted ? [{ profile_id: 'prof-jared', access: 'manager' }, { profile_id: 'prof-anthony', access: 'manager' }] : [],
    description: d.restricted ? 'Restricted: directors and the general manager (add members in Drive).' : 'Shared with the whole company.', _generated: true });

  const folderId = (driveId, parts) => {
    let parent = null;
    for (let i = 0; i < parts.length; i++) {
      const id = ctx.id('fld', driveId, ...parts.slice(0, i + 1));
      if (!out.folders.some(f => f.id === id)) out.folders.push({ id, name: parts[i], drive_id: driveId, parent_id: parent, _generated: true });
      parent = id;
    }
    return parent;
  };

  // extra links for files no record cites directly
  const HR = ctx.has('people_hr') ? ctx.k('people_hr').entities : { staff_photos: [] };
  const { ALIASES } = await import('./50-people.mjs');
  const empByName = n => { const w = String(n || '').replace(/\(.*?\)/g, ' ').trim().toUpperCase().split(/\s+/); for (const x of w) if (ALIASES[x]) return ALIASES[x]; const last = w[w.length - 1]; return [...(ctx.records.employees || new Map()).values()].find(e => (e.full_name || '').toUpperCase().includes(last))?.id || null; };
  const extraLinks = f => {
    const n = f.name.toLowerCase(), out2 = [];
    const deck = /garden design/.test(n) ? 'Garden design options' : /paving/.test(n) ? 'Paving options' : null;
    if (deck) for (const d of (ctx.records.design_options || new Map()).values()) if (d.deck === deck) out2.push({ collection: 'design_options', id: d.id });
    if (/ex employees\.xlsx/.test(n)) out2.push({ collection: 'employees', id: 'emp-ramsaroop' });
    if (/dsw application/.test(n)) out2.push({ collection: 'compliance_docs', id: 'cd-dsw-cornubia' });
    const photo = (HR.staff_photos || []).find(p => pathKey(p.file || '') === pathKey(f.src) || String(p.file || '').endsWith(f.name));
    if (photo) { const e = empByName(photo.linked_person); if (e) out2.push({ collection: 'employees', id: e }); }
    return out2;
  };

  for (const f of index.files) {
    let [drive, base] = GROUP[f.group] || ['drive-admin', 'Other'];
    if (f.group === 'projects_fleet_purchases') { if (/\/Purchases\//i.test(f.src)) [drive, base] = ['drive-finance', 'Purchases']; else if (/\/References\//i.test(f.src)) [drive, base] = ['drive-sales', 'References']; }
    if (/\/(EX_?\s?Employees|EMPLOYEES)\b/i.test(f.src)) [drive, base] = ['drive-hr', 'Employees'];
    const inner = folderParts(f.src);
    const parts = inner.length ? inner : [base];
    const links = [...(linkedBy.get(pathKey(f.src)) || []), ...extraLinks(f)].filter((l, i, a) => a.findIndex(x => x.collection === l.collection && x.id === l.id) === i);
    const txt = txtBySrc.get(pathKey(f.src));
    const text = txt && existsSync(join(SP, txt)) ? readFileSync(join(SP, txt), 'utf8').replace(/^# .*$/m, '').replace(/=== (PAGE|SLIDE) \d+ ===/g, ' ').replace(/\[[^\]]+\]\s?/g, '').replace(/\s+/g, ' ').trim().slice(0, 8000) : null;
    out.files.push({
      // id from the content hash: identical names in different folders stay separate
      id: `file-${f.sha256.slice(0, 24)}`, name: f.name, drive_id: drive, folder_id: folderId(drive, parts), mime: f.mime, size: f.size, kind: 'pending',
      description: `Original company document${links.length ? ` · ${links.length} record${links.length === 1 ? '' : 's'} in the system came from it` : ''}. Import the document vault in Drive to attach the file itself.`,
      tags: [f.group ? f.group.replace(/_/g, ' ') : 'other'], text_index: text, source_path: f.src, linked: links, version: 1,
      expires_on: expiryOf(links), confidential: CONFIDENTIAL.test(f.src) || f.group === 'medicals',
      sha256: f.sha256, also_at: f.also_at && f.also_at.length ? f.also_at : undefined, _src: f.src
    });
  }
  return out;
}
