/* =============================================================================
   Files — bytes live in IndexedDB (local mode) or the private Supabase Storage
   bucket 'drive' (production). Metadata lives in the `files` collection so
   files can be searched, starred, shared and linked to any record.
   ========================================================================== */

import { CONFIG, IS_SUPABASE } from '../config.js';
import { db } from './db.js';
import { idb } from './idb.js';
import { store } from './bus.js';
import { uid, h, downloadBlob } from '../ui/dom.js';
import { modal, toast, showError } from '../ui/overlays.js';
import { icon } from '../ui/icons.js';
import * as fmt from './format.js';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file (Supabase free-tier limit)

export function filesFor(col, id) {
  return db.all('files').filter(f => Array.isArray(f.linked) && f.linked.some(l => l.collection === col && l.id === id));
}

/**
 * uploadFiles(fileList, { drive_id, folder_id, linked:[{collection,id}], description, confidential }) -> [file records]
 */
export async function uploadFiles(fileList, o = {}) {
  const out = [];
  for (const file of fileList) {
    if (file.size > MAX_BYTES) { toast.error(`${file.name} is too large`, { text: `Maximum is ${fmt.fileSize(MAX_BYTES)}` }); continue; }
    try {
      const id = uid();
      const path = `${o.drive_id || 'my-drive'}/${id}/${file.name.replace(/[^\w.\- ()]+/g, '_')}`;
      if (IS_SUPABASE()) {
        const { error } = await db.client.storage.from(CONFIG.buckets.drive).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (error) throw new Error(error.message);
      } else {
        await idb.putBlob(id, file, { name: file.name, type: file.type, size: file.size });
      }
      const text = await extractText(file).catch(() => '');
      const rec = await db.insert('files', {
        id, name: file.name, mime: file.type || guessMime(file.name), size: file.size, drive_id: o.drive_id || null, folder_id: o.folder_id || null,
        storage_path: IS_SUPABASE() ? path : null, blob_id: IS_SUPABASE() ? null : id, kind: 'upload',
        linked: o.linked || [], description: o.description || null, text_index: text.slice(0, 20000), confidential: !!o.confidential, owner_id: (store.get('user') || {}).id || null
      });
      out.push(rec);
    } catch (e) { showError(e, `Upload failed: ${file.name}`); }
  }
  if (out.length) toast.success(out.length === 1 ? `Uploaded ${out[0].name}` : `Uploaded ${out.length} files`);
  return out;
}

/** Store bytes for an existing metadata record (used by the document-vault importer). */
export async function attachBytes(fileRec, blob) {
  if (IS_SUPABASE()) {
    const path = fileRec.storage_path || `${fileRec.drive_id || 'my-drive'}/${fileRec.id}/${fileRec.name.replace(/[^\w.\- ()]+/g, '_')}`;
    const { error } = await db.client.storage.from(CONFIG.buckets.drive).upload(path, blob, { contentType: fileRec.mime || blob.type, upsert: true });
    if (error) throw new Error(error.message);
    return db.update('files', fileRec.id, { storage_path: path, kind: 'upload', size: blob.size }, { skipValidate: true });
  }
  await idb.putBlob(fileRec.id, blob, { name: fileRec.name, type: fileRec.mime, size: blob.size });
  return db.update('files', fileRec.id, { blob_id: fileRec.id, kind: 'upload', size: blob.size }, { skipValidate: true });
}

export async function getBlob(fileRec) {
  if (fileRec.kind === 'pending') return null;
  if (IS_SUPABASE() && fileRec.storage_path) {
    const { data, error } = await db.client.storage.from(CONFIG.buckets.drive).download(fileRec.storage_path);
    if (error) throw new Error(error.message);
    return data;
  }
  const row = await idb.getBlob(fileRec.blob_id || fileRec.id);
  return row ? row.blob : null;
}

export async function fileUrl(fileRec) {
  const blob = await getBlob(fileRec);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function downloadFile(fileRec) {
  try {
    const blob = await getBlob(fileRec);
    if (!blob) return toast.warn('The file bytes are not in the system yet', { text: 'A manager can import the document vault (Drive → Import document vault), or upload the file again.' });
    downloadBlob(blob, fileRec.name);
  } catch (e) { showError(e, 'Download failed'); }
}

export async function deleteFileBytes(fileRec) {
  if (IS_SUPABASE() && fileRec.storage_path) await db.client.storage.from(CONFIG.buckets.drive).remove([fileRec.storage_path]);
  else await idb.deleteBlob(fileRec.blob_id || fileRec.id);
}

/** Open a preview (PDF, image, text, video) with download / open-in-tab actions. */
export async function openFile(fileRec) {
  if (fileRec.kind && !['upload', 'pending'].includes(fileRec.kind) && fileRec.ref_id) {
    const target = { doc: 'docs', sheet: 'sheets', slides: 'slides', form: 'forms' }[fileRec.kind];
    location.hash = `#/${target}/${fileRec.ref_id}`;
    return;
  }
  let url = null;
  try { url = await fileUrl(fileRec); } catch (e) { showError(e, 'Could not open file'); return; }
  const mime = fileRec.mime || guessMime(fileRec.name);
  let body;
  if (!url) body = h('div.empty', h('div.e-art', icon('cloud-off', 40)), h('h3', 'File not uploaded yet'), h('p', `This record points to the original document “${fileRec.source_path || fileRec.name}”. A manager can import the document vault (Drive → Import document vault) to make it viewable here.`));
  else if (mime.includes('pdf')) body = h('iframe', { src: url, title: fileRec.name, style: 'width:100%;height:72vh;border:0;border-radius:12px;background:#fff' });
  else if (mime.startsWith('image/')) body = h('img', { src: url, alt: fileRec.name, style: 'max-width:100%;max-height:72vh;margin:auto;border-radius:12px' });
  else if (mime.startsWith('video/')) body = h('video', { src: url, controls: true, style: 'width:100%;max-height:72vh;border-radius:12px' });
  else if (mime.startsWith('text/') || /\.(csv|txt|md|json)$/i.test(fileRec.name)) { const t = await (await getBlob(fileRec)).text(); body = h('pre', { style: 'white-space:pre-wrap;max-height:72vh;overflow:auto;background:var(--surface-2);padding:16px;border-radius:12px' }, t.slice(0, 200000)); }
  else body = h('div.empty', h('div.e-art', icon('file', 40)), h('h3', fileRec.name), h('p', `${mime || 'Unknown type'} · ${fmt.fileSize(fileRec.size)} — no preview for this type. Download it to open.`));
  modal({
    title: fileRec.name, icon: 'file', tile: 't-grass', size: 'xwide', body,
    onClose: () => url && setTimeout(() => URL.revokeObjectURL(url), 5000),
    actions: url ? [
      { label: 'Open in new tab', icon: 'external-link', variant: 'ghost', close: false, onClick: () => { window.open(url, '_blank', 'noopener'); return false; } },
      { label: 'Download', icon: 'download', variant: 'primary', close: false, onClick: () => { downloadFile(fileRec); return false; } }
    ] : [{ label: 'Close', variant: 'primary' }]
  });
}

export function guessMime(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mp4: 'video/mp4', zip: 'application/zip' })[ext] || 'application/octet-stream';
}

export function fileIcon(f) {
  const m = f.mime || guessMime(f.name || '');
  if (f.kind === 'doc') return ['file-text', 't-river'];
  if (f.kind === 'sheet') return ['sheet', 't-grass'];
  if (f.kind === 'slides') return ['presentation', 't-sun'];
  if (f.kind === 'form') return ['clipboard-list', 't-violet'];
  if (m.includes('pdf')) return ['file-text', 't-rose'];
  if (m.startsWith('image/')) return ['image', 't-clay'];
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return ['file-spreadsheet', 't-grass'];
  if (m.includes('word')) return ['file-type', 't-river'];
  if (m.includes('presentation') || m.includes('powerpoint')) return ['presentation', 't-sun'];
  if (m.startsWith('video/')) return ['film', 't-violet'];
  if (m.includes('zip')) return ['file-archive', 't-slate'];
  return ['file', 't-slate'];
}

/** Best-effort text extraction for search (plain text, CSV, JSON). PDFs/Office are indexed by the vault importer. */
async function extractText(file) {
  if (/^text\/|json|csv/.test(file.type || '') || /\.(txt|csv|md|json)$/i.test(file.name)) return (await file.text()).slice(0, 20000);
  return '';
}

export async function storageUsed() {
  if (IS_SUPABASE()) return db.all('files').reduce((a, f) => a + (f.size || 0), 0);
  return idb.blobUsage();
}
