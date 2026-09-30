/* =============================================================================
   Quote & invoice documents: the editor (works one-handed on a phone on site),
   branded PDF output, the "send" sheet (WhatsApp / email / download) and the
   payment + proof-of-payment dialog. Used by the quotes, invoices, payments,
   clients and jobs apps.
   ========================================================================== */

import { h, ensureStyle, downloadBlob, copyText } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { btn, badge, card, pageHeader, callout, kv } from '../ui/components.js';
import { modal, toast, showError, confirm } from '../ui/overlays.js';
import { fieldInput, refPicker } from '../ui/form.js';
import { celebrate } from '../ui/animate.js';
import { db } from '../core/db.js';
import { can } from '../core/perms.js';
import { store } from '../core/bus.js';
import { uploadFiles } from '../core/files.js';
import { lineTotal, formatMoney, toCents } from '../core/money.js';
import { today, addDays } from '../core/dates.js';
import * as fmt from '../core/format.js';
import { company, printBank, cleanLines, totalsOf, withTotals, nextNumber, balanceOf, invoiceState, recordPayment, waLink, mailtoLink, invoiceMessage, quoteMessage, paymentsFor, matchPop } from './_biz.js';

const COL = { quote: 'quotes', invoice: 'invoices' };
export const INVOICE_STATE_BADGE = { draft: ['Draft', 'gray'], unpaid: ['Unpaid', 'blue'], partially_paid: ['Partially paid', 'gold'], awaiting_pop: ['Awaiting POP', 'violet'], paid: ['Paid', 'green'], overdue: ['Overdue', 'red'], void: ['Void', 'gray'], not_recorded: ['Payment not recorded', 'clay'] };
export const QUOTE_BADGE = { draft: ['Draft', 'gray'], sent: ['Sent', 'blue'], viewed: ['Viewed', 'violet'], accepted: ['Accepted', 'green'], rejected: ['Declined', 'red'], expired: ['Expired', 'clay'], superseded: ['Superseded', 'gray'] };
export function invoiceBadge(inv) { const s = invoiceState(inv); const [l, c] = INVOICE_STATE_BADGE[s] || [s, 'gray']; return badge(l, c); }
export function quoteBadge(q) { const s = q.status === 'sent' && q.valid_until && q.valid_until < today() ? 'expired' : q.status; const [l, c] = QUOTE_BADGE[s] || [s, 'gray']; return badge(l, c); }

ensureStyle('lsi-docs', `
.doc-lines{display:flex;flex-direction:column;gap:10px}
.doc-line{display:grid;grid-template-columns:minmax(0,1fr) 90px 130px 80px 120px 36px;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:14px;background:var(--surface);animation:popIn .25s var(--ease-out)}
.doc-line .amt{font-variant-numeric:tabular-nums;text-align:right;font-weight:600}
.doc-line-head{display:grid;grid-template-columns:minmax(0,1fr) 90px 130px 80px 120px 36px;gap:8px;padding:0 10px;font-size:var(--fs-xs);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.doc-totals{margin-left:auto;min-width:260px;display:grid;grid-template-columns:1fr auto;gap:6px 18px;font-variant-numeric:tabular-nums}
.doc-totals .grand{font-size:1.35rem;font-weight:800;color:var(--brand)}
.doc-sticky{position:sticky;bottom:0;z-index:5;display:flex;gap:8px;align-items:center;padding:12px;margin:18px -4px 0;border-radius:18px;background:var(--glass);backdrop-filter:blur(14px);border:1px solid var(--border);box-shadow:var(--shadow-lg)}
.svc-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.svc-chips .chip{white-space:nowrap}
@media (max-width: 760px){
  .doc-line-head{display:none}
  .doc-line{grid-template-columns:1fr 1fr;grid-template-areas:"d d" "q u" "p a" "x x"}
  .doc-line>:nth-child(1){grid-area:d}.doc-line>:nth-child(2){grid-area:q}.doc-line>:nth-child(3){grid-area:u}
  .doc-line>:nth-child(4){grid-area:p}.doc-line>:nth-child(5){grid-area:a;align-self:center}.doc-line>:nth-child(6){grid-area:x;justify-self:end}
  .doc-totals{min-width:0;width:100%}
}`);

/* =============================================================================
   Editor
   ========================================================================== */
/**
 * docEditor('invoice'|'quote', ctx, { id, values }) → page Node.
 * Saves a draft or issues the document (assigns the next number), then opens it.
 */
export function docEditor(kind, ctx, o = {}) {
  const col = COL[kind];
  const c = company();
  const existing = o.id ? db.get(col, o.id) : null;
  const base = kind === 'invoice'
    ? { status: 'draft', kind: 'adhoc', issue_date: today(), due_date: addDays(today(), Number(c.default_due_days) || 7), vat_applied: !!c.vat_registered, discount: 0, amount_paid: 0, terms: c.invoice_terms, lines: [] }
    : { status: 'draft', issue_date: today(), valid_until: addDays(today(), Number(c.quote_valid_days) || 30), vat_applied: !!c.vat_registered, discount: 0, deposit_pct: Number(c.deposit_pct) || 50, terms: c.quote_terms, lines: [], salesperson: (store.get('user') || {}).full_name || null };
  const v = { ...base, ...(existing || {}), ...(o.values || {}) };
  if (!Array.isArray(v.lines) || !v.lines.length) v.lines = [{ description: '', qty: 1, unit_price: null, discount_pct: 0 }];
  v.lines = v.lines.map(l => ({ ...l }));
  if (existing && existing.total_override_reason) return callout('warning', 'Legacy invoice', 'This invoice was imported from a PDF whose printed total differs from its lines. It is kept exactly as printed and cannot be edited line by line — use Edit (all details) instead.', 'lock');

  const linesBox = h('div.doc-lines');
  const totalsBox = h('div.doc-totals');
  const clientInfo = h('div.small.muted');
  const err = h('div');

  const drawTotals = () => {
    const t = totalsOf(v);
    const dep = kind === 'quote' && v.deposit_pct ? Math.round(toCents(t.total) * v.deposit_pct / 100) / 100 : null;
    totalsBox.replaceChildren(
      h('span.muted', 'Subtotal'), h('span', fmt.money(t.subtotal)),
      t.discount ? h('span.muted', 'Discount') : null, t.discount ? h('span', `− ${fmt.money(t.discount)}`) : null,
      v.vat_applied ? h('span.muted', `VAT ${Math.round((t.vat / (t.net || 1)) * 100) || 15}%`) : null, v.vat_applied ? h('span', fmt.money(t.vat)) : null,
      h('span', { style: 'font-weight:700' }, 'Total'), h('span.grand', fmt.money(t.total)),
      dep != null ? h('span.muted', `Deposit ${v.deposit_pct}%`) : null, dep != null ? h('span', fmt.money(dep)) : null);
  };
  const lineRow = (l, i) => {
    const amt = h('div.amt', fmt.money(lineTotal(l.qty ?? 1, l.unit_price || 0, l.discount_pct || 0)));
    const upd = () => { amt.textContent = fmt.money(lineTotal(l.qty === '' || l.qty == null ? 1 : l.qty, l.unit_price || 0, l.discount_pct || 0)); drawTotals(); };
    return h('div.doc-line',
      h('input.input', { value: l.description || '', placeholder: 'Description (e.g. Lawn installation — Buffalo grass)', 'aria-label': 'Description', onInput: e => { l.description = e.target.value; } }),
      h('input.input', { type: 'number', step: 'any', inputmode: 'decimal', value: l.qty ?? 1, 'aria-label': 'Quantity', onInput: e => { l.qty = e.target.value === '' ? '' : Number(e.target.value); upd(); } }),
      h('div.input-group', h('span.addon', 'R'), h('input.input', { type: 'number', step: 'any', inputmode: 'decimal', value: l.unit_price ?? '', placeholder: '0.00', 'aria-label': 'Unit price', onInput: e => { l.unit_price = e.target.value === '' ? null : Number(e.target.value); upd(); } })),
      h('div.input-group', h('input.input', { type: 'number', step: 'any', min: 0, max: 100, value: l.discount_pct || '', placeholder: '0', 'aria-label': 'Line discount %', onInput: e => { l.discount_pct = Number(e.target.value) || 0; upd(); } }), h('span.addon', '%')),
      amt,
      h('button.btn.btn-ghost.btn-icon', { type: 'button', 'aria-label': 'Remove line', onClick: () => { v.lines.splice(i, 1); if (!v.lines.length) v.lines.push({ description: '', qty: 1, unit_price: null, discount_pct: 0 }); drawLines(); } }, icon('trash-2', 16)));
  };
  const drawLines = () => { linesBox.replaceChildren(...v.lines.map(lineRow)); drawTotals(); };
  const addLine = (l = {}) => { v.lines.push({ description: '', qty: 1, unit_price: null, discount_pct: 0, ...l }); drawLines(); const inputs = linesBox.querySelectorAll('.doc-line'); inputs[inputs.length - 1]?.querySelector('input')?.focus(); };

  const services = db.all('services').filter(s => s.active !== false);
  const svcChips = services.length ? h('div.svc-chips', services.slice(0, 40).map(s => h('button.chip', { type: 'button', title: s.description || '', onClick: () => addLine({ description: s.name + (s.description ? ` — ${s.description.split('\n')[0]}` : ''), qty: 1, unit_price: s.rate ?? null, service_id: s.id }) }, icon('plus', 13), s.name, s.rate != null ? h('span.muted', ` ${fmt.money(s.rate)}${s.unit ? '/' + s.unit : ''}`) : null))) : null;

  const pickClient = id => {
    v.client_id = id;
    const cl = id ? db.get('clients', id) : null;
    if (cl) {
      v.client_name = cl.name;
      v.bill_to = [cl.name, cl.company && cl.company !== cl.name ? cl.company : null, cl.address, cl.suburb].filter(Boolean).join('\n');
      if (kind === 'invoice' && !v.reference) v.reference = cl.legacy_code || null;
      nameInput.value = v.client_name; billInput.value = v.bill_to;
    }
    clientInfo.replaceChildren(cl ? h('span', cl.phone ? fmt.phone(cl.phone) : '', cl.email ? ` · ${cl.email}` : '', cl.preferred_channel ? ` · prefers ${cl.preferred_channel}` : '') : '');
  };
  const nameInput = h('input.input', { value: v.client_name || '', placeholder: 'Client name as it should print', onInput: e => { v.client_name = e.target.value; } });
  const billInput = h('textarea.textarea', { rows: 3, value: v.bill_to || '', placeholder: 'Name, address…', onInput: e => { v.bill_to = e.target.value; } });
  const field = (label, input, hint, full) => h('div', { class: ['field', full ? 'full' : ''] }, h('label.field-label', label), input, hint ? h('div.field-hint', hint) : null);
  const f = (name, def) => fieldInput(def, v[name], x => { v[name] = x; if (['vat_applied', 'discount', 'deposit_pct'].includes(name)) drawTotals(); });

  const leadPicker = kind === 'quote' ? field('Lead', refPicker({ ref: 'leads' }, v.lead_id, id => { v.lead_id = id; const l = id && db.get('leads', id); if (l && !v.client_name) { v.client_name = l.name; nameInput.value = l.name; } })) : null;

  async function save(issue) {
    const lines = cleanLines(v.lines);
    const problems = [];
    if (!String(v.client_name || '').trim()) problems.push('Choose a client or type the client name');
    if (!lines.length) problems.push('Add at least one line with a description and price');
    if (kind === 'quote' && !String(v.title || '').trim()) problems.push('Give the quote a short description');
    if (lines.some(l => !l.description)) problems.push('Every line needs a description');
    if (problems.length) { err.replaceChildren(callout('danger', 'Almost there', problems.join(' · '), 'circle-alert')); err.scrollIntoView({ behavior: 'smooth', block: 'center' }); return null; }
    err.replaceChildren();
    let rec = withTotals({ ...v, lines });
    if (kind === 'quote' && rec.deposit_pct) rec.deposit_amount = Math.round(toCents(rec.total) * rec.deposit_pct / 100) / 100;
    if (issue) {
      if (!rec.number) rec.number = await nextNumber(kind);
      rec.status = kind === 'invoice' ? (rec.status === 'draft' ? 'unpaid' : rec.status) : (rec.status === 'draft' ? 'sent' : rec.status);
      if (kind === 'invoice' && !rec.reference) rec.reference = rec.number;
    }
    delete rec.id;
    const res = db.check(col, rec, { id: existing && existing.id });
    if (!res.ok) { err.replaceChildren(callout('danger', 'Please check', Object.values(res.errors).join(' · '), 'circle-alert')); return null; }
    try {
      const saved = existing ? await db.update(col, existing.id, rec) : await db.insert(col, rec);
      toast.success(issue ? `${kind === 'quote' ? 'Quote' : 'Invoice'} ${saved.number} issued` : 'Draft saved', { text: `${saved.client_name} · ${fmt.money(saved.total)}` });
      return saved;
    } catch (e) { showError(e); return null; }
  }

  drawLines(); pickClient(v.client_id || null); if (!v.client_id) clientInfo.replaceChildren();
  const title = existing ? `Edit ${existing.number || existing.legacy_number || (kind === 'quote' ? 'quote' : 'invoice')}` : kind === 'quote' ? 'New quote' : 'New invoice';
  return h('div',
    pageHeader({ title, sub: kind === 'invoice' ? 'Fill in the client and lines — the total, VAT and number are handled for you.' : 'Build the quote from the price list or free-type any line.', icon: kind === 'quote' ? 'file-signature' : 'receipt', tile: kind === 'quote' ? 't-clay' : 't-violet', crumbs: [{ label: kind === 'quote' ? 'Quotes' : 'Invoices', href: `#/${col}` }, { label: title }] }),
    err,
    card({ title: 'Client', icon: 'user', cls: 'solid' },
      h('div.form-grid',
        field('Find client', refPicker({ ref: 'clients' }, v.client_id, pickClient), 'Search the client list — or type a new name below'),
        field('Name on the document', nameInput),
        leadPicker,
        field('Bill to', billInput, null, true), h('div.full', clientInfo))),
    card({ title: 'Details', icon: 'file-cog', cls: 'solid' },
      h('div.form-grid',
        kind === 'quote' ? field('Description', f('title', { type: 'text', placeholder: 'e.g. Garden makeover — front lawn & paving' }), null, true) : null,
        kind === 'invoice' ? field('Type', f('kind', { type: 'enum', required: true, options: [{ value: 'maintenance', label: 'Monthly maintenance' }, { value: 'adhoc', label: 'Ad-hoc / project' }, { value: 'deposit', label: 'Deposit' }, { value: 'balance', label: 'Balance' }, { value: 'credit_note', label: 'Credit note' }] })) : null,
        field(kind === 'quote' ? 'Quote date' : 'Invoice date', f('issue_date', { type: 'date' })),
        kind === 'invoice' ? field('Due date', f('due_date', { type: 'date' })) : field('Valid until', f('valid_until', { type: 'date' })),
        kind === 'invoice' ? field('Service month', f('period', { type: 'text', placeholder: 'YYYY-MM' }), 'For monthly maintenance, e.g. 2026-10') : field('Deposit %', f('deposit_pct', { type: 'percent' })),
        kind === 'invoice' ? field('Payment reference', f('reference', { type: 'text', placeholder: 'Defaults to the invoice number' })) : field('Salesperson', f('salesperson', { type: 'text' })),
        field('Add VAT', f('vat_applied', { type: 'bool', switchLabel: c.vat_registered ? 'VAT registered' : 'Not VAT registered' })),
        field('Discount on total', f('discount', { type: 'money', min: 0 })))),
    card({ title: 'Line items', icon: 'list', cls: 'solid', actions: [btn({ label: 'Add line', icon: 'plus', size: 'sm', onClick: () => addLine() })] },
      svcChips ? h('div', { style: 'margin-bottom:12px' }, h('div.small.muted', { style: 'margin-bottom:6px' }, 'Tap a service to add it'), svcChips) : null,
      h('div.doc-line-head', h('span', 'Description'), h('span', 'Qty'), h('span', 'Unit price'), h('span', 'Disc.'), h('span', { style: 'text-align:right' }, 'Amount'), h('span')),
      linesBox,
      h('div.row', { style: 'margin-top:14px;align-items:flex-start' }, btn({ label: 'Add line', icon: 'plus', variant: 'ghost', onClick: () => addLine() }), h('div.spacer'), totalsBox)),
    card({ title: 'Terms & notes', icon: 'scroll-text', cls: 'solid' },
      h('div.form-grid', field('Terms (print on the document)', f('terms', { type: 'longtext', rows: 3 }), null, true), field('Internal notes (not printed)', f('notes', { type: 'longtext', rows: 2 }), null, true),
        kind === 'invoice' ? field('Client signature (optional, on site)', f('signature', { type: 'signature' }), null, true) : null)),
    h('div.doc-sticky',
      btn({ label: 'Cancel', variant: 'ghost', onClick: () => history.back() }),
      h('div.spacer'),
      btn({ label: 'Save draft', icon: 'save', onClick: async e => { const r = await save(false); if (r) ctx.navigate(`${col}/${col === 'quotes' ? 'q' : 'i'}/${encodeURIComponent(r.id)}`); } }),
      btn({ label: existing && existing.number ? 'Save' : kind === 'quote' ? 'Issue quote' : 'Issue invoice', icon: 'send', variant: 'primary', onClick: async () => { const r = await save(true); if (r) { ctx.navigate(`${col}/${col === 'quotes' ? 'q' : 'i'}/${encodeURIComponent(r.id)}`); if (!existing || !existing.number) setTimeout(() => sendSheet(kind, db.get(col, r.id)), 350); } } })));
}

/* =============================================================================
   PDF
   ========================================================================== */
let logoData = null;
async function logo() {
  if (logoData !== null) return logoData;
  try { const b = await (await fetch('assets/landscapers-logo.jpg')).blob(); logoData = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); } catch { logoData = ''; }
  return logoData;
}
/** Branded A4 PDF for a quote or invoice. Returns a Blob. */
export async function docPdf(kind, rec) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error('The PDF library did not load — check your connection and reload.');
  const c = company(), bank = printBank();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 16, green = [23, 90, 51], dark = [16, 61, 36], grey = [110, 120, 115];
  doc.setFillColor(...dark); doc.rect(0, 0, W, 6, 'F');
  doc.setFillColor(124, 194, 78); doc.rect(0, 6, W, 1.4, 'F');
  const lg = await logo();
  if (lg) { try { doc.addImage(lg, 'JPEG', M, 13, 30, 30); } catch { /* ignore bad image */ } }
  doc.setTextColor(...dark); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(c.trading_name, lg ? M + 35 : M, 21);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...grey);
  const coLines = [c.legal_name ? `${c.legal_name}${c.reg_no ? ` · Reg. ${c.reg_no}` : ''}` : null, c.address, [c.phone, c.email].filter(Boolean).join(' · '), c.website, c.vat_registered && c.vat_number ? `VAT no. ${c.vat_number}` : null].filter(Boolean).flatMap(t => String(t).split('\n'));
  coLines.forEach((t, i) => doc.text(t, lg ? M + 35 : M, 27 + i * 4.2));
  const title = kind === 'quote' ? 'QUOTATION' : rec.kind === 'credit_note' ? 'CREDIT NOTE' : 'TAX INVOICE';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...green); doc.text(kind === 'invoice' && !c.vat_registered ? (rec.kind === 'credit_note' ? 'CREDIT NOTE' : 'INVOICE') : title, W - M, 22, { align: 'right' });
  doc.setFontSize(9); doc.setTextColor(40, 40, 40);
  const meta = kind === 'quote'
    ? [['Quote no.', rec.number || rec.legacy_number || 'DRAFT'], ['Date', fmt.date(rec.issue_date, 'long')], ['Valid until', rec.valid_until ? fmt.date(rec.valid_until, 'long') : '—'], ['Prepared by', rec.salesperson || '—']]
    : [['Invoice no.', rec.number || rec.legacy_number || 'DRAFT'], ['Date', fmt.date(rec.issue_date, 'long')], ['Due date', rec.due_date ? fmt.date(rec.due_date, 'long') : 'On receipt'], ['Reference', rec.reference || rec.number || '—'], rec.period ? ['Service month', rec.period] : null].filter(Boolean);
  meta.forEach(([k, val], i) => { doc.setFont('helvetica', 'normal'); doc.setTextColor(...grey); doc.text(k, W - M - 48, 30 + i * 5); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 30); doc.text(String(val), W - M, 30 + i * 5, { align: 'right' }); });
  let y = 56;
  doc.setDrawColor(225, 232, 228); doc.setFillColor(244, 249, 245); doc.roundedRect(M, y, 100, 28, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...green); doc.text(kind === 'quote' ? 'PREPARED FOR' : 'BILL TO', M + 4, y + 6);
  doc.setFontSize(10); doc.setTextColor(25, 25, 25);
  const bt = String(rec.bill_to || rec.client_name || '').split('\n').filter(Boolean).slice(0, 4);
  bt.forEach((t, i) => { doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.text(doc.splitTextToSize(t, 92)[0], M + 4, y + 12 + i * 4.6); });
  if (kind === 'quote' && rec.title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...dark); doc.text(doc.splitTextToSize(rec.title, 80), W - M, y + 8, { align: 'right' }); }
  y += 36;
  const lines = Array.isArray(rec.lines) ? rec.lines : [];
  doc.autoTable({
    startY: y, margin: { left: M, right: M },
    head: [['#', 'Description', 'Qty', 'Unit price', 'Disc.', 'Amount']],
    body: lines.map((l, i) => [i + 1, l.description || '', fmt.num(l.qty ?? 1, Number.isInteger(Number(l.qty ?? 1)) ? 0 : 2), formatMoney(Number(l.unit_price) || 0, { decimals: 2 }), l.discount_pct ? `${l.discount_pct}%` : '', formatMoney(l.amount ?? lineTotal(l.qty ?? 1, l.unit_price || 0, l.discount_pct || 0))]),
    styles: { fontSize: 9, cellPadding: 2.6, textColor: [35, 35, 35], lineColor: [230, 236, 232], lineWidth: 0.2 },
    headStyles: { fillColor: dark, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 251, 249] },
    columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 2: { cellWidth: 14, halign: 'right' }, 3: { cellWidth: 28, halign: 'right' }, 4: { cellWidth: 14, halign: 'right' }, 5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' } }
  });
  y = doc.lastAutoTable.finalY + 6;
  const t = rec.total_override_reason ? { subtotal: rec.subtotal ?? rec.total, discount: rec.discount || 0, vat: rec.vat || 0, total: rec.total } : totalsOf(rec);
  const rows = [['Subtotal', t.subtotal], t.discount ? ['Discount', -t.discount] : null, rec.vat_applied ? [`VAT (${Math.round((c.vatRate || 0.15) * 100)}%)`, t.vat] : null, ['TOTAL', rec.total ?? t.total]].filter(Boolean);
  if (kind === 'invoice' && Number(rec.amount_paid) > 0) rows.push(['Paid', -rec.amount_paid], ['BALANCE DUE', balanceOf(rec)]);
  if (kind === 'quote' && rec.deposit_amount) rows.push([`Deposit to confirm (${rec.deposit_pct}%)`, rec.deposit_amount]);
  if (y > 250) { doc.addPage(); y = 20; }
  rows.forEach(([k, val], i) => {
    const strong = /TOTAL|BALANCE/.test(k);
    if (strong) { doc.setFillColor(...dark); doc.roundedRect(W - M - 78, y - 4.6, 78, 7.4, 1.5, 1.5, 'F'); doc.setTextColor(255, 255, 255); } else doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', strong ? 'bold' : 'normal'); doc.setFontSize(strong ? 10.5 : 9.5);
    doc.text(k, W - M - 74, y); doc.text(formatMoney(val), W - M - 3, y, { align: 'right' });
    y += strong ? 9 : 6;
    void i;
  });
  let by = doc.lastAutoTable.finalY + 6;
  if (bank && kind === 'invoice') {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...green); doc.text('BANKING DETAILS', M, by);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40);
    [[`Bank`, bank.bank], ['Account name', bank.account_name], ['Account no.', bank.account_no], bank.branch_code ? ['Branch code', bank.branch_code] : null, ['Reference', rec.reference || rec.number || rec.legacy_number || '']].filter(Boolean).forEach(([k, val], i) => { doc.setTextColor(...grey); doc.text(k, M, by + 5 + i * 4.4); doc.setTextColor(30, 30, 30); doc.text(String(val || ''), M + 26, by + 5 + i * 4.4); });
    by += 30;
  }
  y = Math.max(y, by) + 2;
  const terms = [rec.terms, kind === 'invoice' ? c.invoice_footer_notes : null].filter(Boolean).join('\n\n');
  if (terms) {
    if (y > 255) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...green); doc.text(kind === 'quote' ? 'TERMS & CONDITIONS' : 'TERMS', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80);
    const tl = doc.splitTextToSize(terms, W - 2 * M); doc.text(tl, M, y + 5); y += 6 + tl.length * 3.6;
  }
  if (rec.signature) { try { if (y > 250) { doc.addPage(); y = 20; } doc.addImage(rec.signature, 'PNG', M, y + 2, 50, 18); doc.setFontSize(7.5); doc.setTextColor(...grey); doc.text(kind === 'quote' ? `Accepted by ${rec.approved_name || 'client'}${rec.approved_at ? ' on ' + fmt.date(rec.approved_at) : ''}` : 'Client signature', M, y + 24); } catch { /* bad image */ } }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(...grey);
    doc.text(`${c.trading_name} · ${c.legal_name || ''}${c.bbbee_level ? ` · B-BBEE Level ${c.bbbee_level}` : ''}`, M, 290);
    doc.text(`Page ${p} of ${pages}`, W - M, 290, { align: 'right' });
    doc.setFillColor(124, 194, 78); doc.rect(0, 294, W, 3, 'F');
  }
  return doc.output('blob');
}
export function docFileName(kind, rec) { return `${kind === 'quote' ? 'Quote' : 'Invoice'} ${rec.number || rec.legacy_number || 'draft'} - ${String(rec.client_name || '').replace(/[^\w\s-]/g, '')}.pdf`.replace(/\s+/g, ' '); }
export async function downloadPdf(kind, rec) {
  try { downloadBlob(await docPdf(kind, rec), docFileName(kind, rec)); } catch (e) { showError(e, 'Could not create the PDF'); }
}
/** Share the PDF with the phone's share sheet when available (WhatsApp with attachment on mobile). */
async function sharePdf(kind, rec, text) {
  const blob = await docPdf(kind, rec);
  const file = new File([blob], docFileName(kind, rec), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, title: docFileName(kind, rec) }); return true; }
  downloadBlob(blob, file.name); return false;
}

/* =============================================================================
   Send sheet
   ========================================================================== */
export function sendSheet(kind, rec, msgKind = 'send') {
  if (!rec) return;
  const col = COL[kind];
  const client = rec.client_id ? db.get('clients', rec.client_id) : null;
  const phone = client ? client.phone || client.phone_alt : null;
  const email = client ? client.billing_email || client.email : null;
  const text = kind === 'quote' ? quoteMessage(rec) : invoiceMessage(rec, msgKind);
  const subject = kind === 'quote' ? `Quotation ${rec.number || ''} — ${company().trading_name}` : msgKind === 'send' ? `Invoice ${rec.number || rec.legacy_number || ''} — ${company().trading_name}` : `Reminder: invoice ${rec.number || rec.legacy_number || ''}`;
  const ta = h('textarea.textarea', { rows: 9, value: text });
  const mark = async via => {
    try {
      if (msgKind === 'send') await db.update(col, rec.id, { sent_at: new Date().toISOString(), sent_via: [...new Set([...(rec.sent_via || []), via])], ...(kind === 'quote' && rec.status === 'draft' ? { status: 'sent' } : {}), ...(kind === 'invoice' && rec.status === 'draft' ? { status: 'unpaid' } : {}) });
      else await db.update('invoices', rec.id, { reminders_sent: [...(rec.reminders_sent || []), { day: msgKind, at: new Date().toISOString(), via, by: (store.get('user') || {}).full_name || null }] });
      await db.insert('outbox', { channel: via, to: (via === 'email' ? email : phone) || rec.client_name, to_name: rec.client_name, subject, body: ta.value, status: 'sent', sent_at: new Date().toISOString(), related_collection: col, related_id: rec.id }).catch(() => {});
    } catch (e) { showError(e); }
  };
  const m = modal({
    title: msgKind === 'send' ? `Send ${kind === 'quote' ? 'quote' : 'invoice'} ${rec.number || rec.legacy_number || ''}` : `${msgKind}-day reminder`, icon: 'send', tile: 't-grass',
    body: h('div.stack',
      h('div.row.wrap.gap-8', h('strong', rec.client_name), phone ? badge(fmt.phone(phone), 'green') : badge('No phone on file', 'gray'), email ? badge(email, 'blue') : badge('No email on file', 'gray'), client && client.preferred_channel ? badge(`Prefers ${client.preferred_channel}`, 'violet') : null),
      h('label.field-label', 'Message'), ta,
      h('div.grid.cols-2',
        btn({ label: 'WhatsApp with PDF', icon: 'message-circle', variant: 'primary', onClick: async () => { await copyText(ta.value); const shared = await sharePdf(kind, rec, ta.value).catch(() => false); if (!shared) window.open(waLink(phone, ta.value), '_blank', 'noopener'); await mark('whatsapp'); toast.success(shared ? 'Shared' : 'PDF downloaded — attach it in WhatsApp', { text: 'The message is also copied to your clipboard.' }); m.close(); } }),
        btn({ label: 'Email', icon: 'mail', onClick: async () => { await downloadPdf(kind, rec); window.location.href = mailtoLink(email, subject, ta.value); await mark('email'); toast.info('PDF downloaded — attach it to the email'); m.close(); } }),
        btn({ label: 'Download PDF', icon: 'download', variant: 'ghost', onClick: () => downloadPdf(kind, rec) }),
        btn({ label: 'Copy message', icon: 'copy', variant: 'ghost', onClick: async () => { await copyText(ta.value); toast.success('Copied'); } })),
      h('p.small.muted', 'On a phone, "WhatsApp with PDF" opens the share sheet so the PDF goes as an attachment. Every send is logged on the document and in the outbox.'))
  });
}

/* =============================================================================
   Payment / proof of payment
   ========================================================================== */
export function paymentDialog(inv, { pop = false } = {}) {
  const bal = balanceOf(inv);
  const v = { amount: bal || inv.total, date: today(), method: 'eft', reference: inv.reference || inv.number || inv.legacy_number || '', status: pop ? 'awaiting_verification' : 'verified', notes: '' };
  let files = null;
  const fi = (label, name, def) => h('div.field', h('label.field-label', label), fieldInput(def, v[name], x => { v[name] = x; }));
  modal({
    title: pop ? 'Upload proof of payment' : `Record payment · ${inv.number || inv.legacy_number || inv.client_name}`, icon: pop ? 'file-up' : 'wallet', tile: 't-rose',
    body: h('div.stack',
      kv([['Client', inv.client_name], ['Invoice total', fmt.money(inv.total)], ['Paid so far', fmt.money(inv.amount_paid || 0)], ['Balance', fmt.money(bal)]]),
      h('div.form-grid',
        fi('Amount (R)', 'amount', { type: 'money', min: 0.01 }), fi('Date received', 'date', { type: 'date' }),
        fi('Method', 'method', { type: 'enum', required: true, options: ['eft', 'cash', 'card', 'cheque', 'other'] }), fi('Bank reference', 'reference', { type: 'text' }),
        fi('Verification', 'status', { type: 'enum', required: true, options: [{ value: 'verified', label: 'Verified — money is in the bank' }, { value: 'awaiting_verification', label: 'POP received — verify against the bank' }] }),
        h('div.field', h('label.field-label', 'Proof of payment (PDF / photo)'), h('input.input', { type: 'file', accept: 'application/pdf,image/*', capture: 'environment', onChange: e => { files = e.target.files; } })),
        h('div.field.full', h('label.field-label', 'Notes'), fieldInput({ type: 'longtext', rows: 2 }, '', x => { v.notes = x; })))),
    actions: [{ label: 'Cancel', variant: 'ghost' }, {
      label: 'Save payment', icon: 'check', variant: 'primary', onClick: async () => {
        if (!(Number(v.amount) > 0)) { toast.error('Enter the amount received'); return false; }
        if (toCents(v.amount) > toCents(bal) && bal > 0 && !(await confirm(`That is ${fmt.money(Number(v.amount) - bal)} more than the balance. Record it anyway?`, { ok: 'Record anyway' }))) return false;
        try {
          let popId = null;
          if (files && files.length) { const [f] = await uploadFiles(files, { drive_id: 'finance', linked: [{ collection: 'invoices', id: inv.id }] }); popId = f && f.id; }
          await recordPayment(inv, { ...v, pop_file_id: popId });
          const after = db.get('invoices', inv.id);
          if (invoiceState(after) === 'paid') { celebrate(); toast.success('Invoice paid in full', { text: `${after.client_name} · ${fmt.money(after.total)}` }); }
          else toast.success(v.status === 'verified' ? 'Payment recorded' : 'POP saved — waiting for bank verification');
        } catch (e) { showError(e); return false; }
      }
    }]
  });
}
export async function verifyPayment(p, ok) {
  await db.update('payments', p.id, { status: ok ? 'verified' : 'rejected' });
  if (p.invoice_id) { const { recomputeInvoice } = await import('./_biz.js'); await recomputeInvoice(p.invoice_id); }
  toast.success(ok ? 'Payment verified' : 'Payment rejected');
}

/** "Which invoice is this POP for?" helper used by the payments app. */
export function popMatcher(onPick) {
  const q = { amount: null, reference: '', name: '' };
  const out = h('div.stack');
  const run = () => {
    const m = matchPop(q).slice(0, 8);
    out.replaceChildren(...(m.length ? m.map(x => h('button.list-item.hover', { type: 'button', onClick: () => onPick(x.inv) },
      h('div.li-main', h('div.li-title', `${x.inv.number || x.inv.legacy_number || 'Invoice'} · ${x.inv.client_name}`), h('div.li-sub', `${fmt.money(balanceOf(x.inv) || x.inv.total)} · ${x.reasons.join(', ')}`)),
      badge(`${Math.round(x.score * 100)}%`, x.score >= 0.7 ? 'green' : x.score >= 0.4 ? 'gold' : 'gray'))) : [h('p.small.muted', 'Type an amount, reference or name to find the invoice.')]));
  };
  run();
  return h('div.stack',
    h('div.form-grid',
      h('div.field', h('label.field-label', 'Amount on the POP'), fieldInput({ type: 'money' }, null, x => { q.amount = x; run(); })),
      h('div.field', h('label.field-label', 'Reference'), fieldInput({ type: 'text' }, '', x => { q.reference = x; run(); })),
      h('div.field', h('label.field-label', 'Payer name'), fieldInput({ type: 'text' }, '', x => { q.name = x; run(); }))),
    out);
}
export { paymentsFor, can };

/* =============================================================================
   On-screen preview (same content as the PDF)
   ========================================================================== */
ensureStyle('lsi-docprev', `
.docprev{background:#fff;color:#1d2a22;border-radius:18px;box-shadow:var(--shadow-lg);padding:28px;max-width:860px;margin:0 auto;position:relative;overflow:hidden}
.docprev:before{content:"";position:absolute;inset:0 0 auto 0;height:6px;background:linear-gradient(90deg,#103d24,#7cc24e)}
.docprev .dp-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.docprev .dp-co{display:flex;gap:12px;align-items:center}.docprev .dp-co img{width:64px;height:64px;border-radius:14px;object-fit:cover}
.docprev h2{margin:0;color:#175a33;font-size:1.6rem;letter-spacing:.04em}
.docprev .dp-meta{display:grid;grid-template-columns:auto auto;gap:3px 14px;font-size:.85rem}.docprev .dp-meta span:nth-child(odd){color:#6e7873}
.docprev .dp-bill{margin:18px 0;padding:12px 14px;background:#f4f9f5;border-radius:12px;white-space:pre-line;font-size:.9rem}
.docprev table{width:100%;border-collapse:collapse;font-size:.88rem}.docprev th{background:#103d24;color:#fff;text-align:left;padding:8px}.docprev td{padding:8px;border-bottom:1px solid #e6ece8}
.docprev td.n,.docprev th.n{text-align:right;font-variant-numeric:tabular-nums}
.docprev .dp-tot{margin:14px 0 0 auto;max-width:300px;display:grid;grid-template-columns:1fr auto;gap:4px 16px;font-variant-numeric:tabular-nums}
.docprev .dp-tot .g{background:#103d24;color:#fff;padding:6px 10px;border-radius:8px;font-weight:800}
.docprev .dp-foot{margin-top:18px;font-size:.78rem;color:#55605a;white-space:pre-line}
.docprev .stamp{position:absolute;right:28px;top:120px;transform:rotate(-14deg);border:3px solid;border-radius:12px;padding:4px 14px;font-weight:900;font-size:1.4rem;letter-spacing:.1em;opacity:.8}
`);
export function docPreview(kind, rec) {
  const c = company(), bank = printBank();
  const t = rec.total_override_reason ? { subtotal: rec.subtotal ?? rec.total, discount: rec.discount || 0, vat: rec.vat || 0, total: rec.total } : totalsOf(rec);
  const state = kind === 'invoice' ? invoiceState(rec) : rec.status;
  const stamp = kind === 'invoice' ? ({ paid: ['PAID', '#1f7440'], overdue: ['OVERDUE', '#c0392b'], void: ['VOID', '#888'], draft: ['DRAFT', '#888'] })[state] : ({ accepted: ['ACCEPTED', '#1f7440'], draft: ['DRAFT', '#888'], rejected: ['DECLINED', '#c0392b'] })[state];
  return h('div.docprev',
    stamp ? h('div.stamp', { style: { color: stamp[1], borderColor: stamp[1] } }, stamp[0]) : null,
    h('div.dp-head',
      h('div.dp-co', h('img', { src: 'assets/landscapers-logo.jpg', alt: '' }), h('div', h('strong', { style: 'font-size:1.15rem;color:#103d24' }, c.trading_name), h('div', { style: 'font-size:.8rem;color:#6e7873;white-space:pre-line' }, [c.legal_name && `${c.legal_name}${c.reg_no ? ' · Reg. ' + c.reg_no : ''}`, c.address, [c.phone, c.email].filter(Boolean).join(' · ')].filter(Boolean).join('\n')))),
      h('div', { style: 'text-align:right' }, h('h2', kind === 'quote' ? 'QUOTATION' : rec.kind === 'credit_note' ? 'CREDIT NOTE' : c.vat_registered ? 'TAX INVOICE' : 'INVOICE'),
        h('div.dp-meta', kind === 'quote'
          ? [h('span', 'Quote no.'), h('strong', rec.number || rec.legacy_number || 'DRAFT'), h('span', 'Date'), h('span', rec.issue_date ? fmt.date(rec.issue_date, 'long') : rec.issue_date_raw || '—'), h('span', 'Valid until'), h('span', rec.valid_until ? fmt.date(rec.valid_until, 'long') : '—')]
          : [h('span', 'Invoice no.'), h('strong', rec.number || rec.legacy_number || 'DRAFT'), h('span', 'Date'), h('span', fmt.date(rec.issue_date, 'long')), h('span', 'Due'), h('span', rec.due_date ? fmt.date(rec.due_date, 'long') : 'On receipt'), h('span', 'Reference'), h('span', rec.reference || rec.number || '—')]))),
    h('div.dp-bill', h('div', { style: 'font-size:.7rem;font-weight:800;color:#175a33;letter-spacing:.08em' }, kind === 'quote' ? 'PREPARED FOR' : 'BILL TO'), rec.bill_to || rec.client_name, kind === 'quote' && rec.title ? h('div', { style: 'margin-top:6px;font-weight:700' }, rec.title) : null),
    h('div', { style: 'overflow-x:auto' }, h('table', h('thead', h('tr', h('th', 'Description'), h('th.n', 'Qty'), h('th.n', 'Unit price'), h('th.n', 'Amount'))),
      h('tbody', (rec.lines || []).map(l => h('tr', h('td', l.description), h('td.n', fmt.num(l.qty ?? 1, Number.isInteger(Number(l.qty ?? 1)) ? 0 : 2)), h('td.n', fmt.money(l.unit_price || 0)), h('td.n', fmt.money(l.amount ?? lineTotal(l.qty ?? 1, l.unit_price || 0, l.discount_pct || 0)))))))),
    h('div.dp-tot', h('span', 'Subtotal'), h('span', fmt.money(t.subtotal)), t.discount ? [h('span', 'Discount'), h('span', `− ${fmt.money(t.discount)}`)] : null, rec.vat_applied ? [h('span', 'VAT'), h('span', fmt.money(t.vat))] : null,
      h('span.g', 'TOTAL'), h('span.g', fmt.money(rec.total ?? t.total)),
      kind === 'invoice' && Number(rec.amount_paid) > 0 ? [h('span', 'Paid'), h('span', `− ${fmt.money(rec.amount_paid)}`), h('strong', 'Balance'), h('strong', fmt.money(balanceOf(rec)))] : null,
      kind === 'quote' && rec.deposit_amount ? [h('span', `Deposit (${rec.deposit_pct}%)`), h('span', fmt.money(rec.deposit_amount))] : null),
    kind === 'invoice' && bank ? h('div.dp-foot', h('strong', 'Banking details\n'), `${bank.bank} · ${bank.account_name} · Acc ${bank.account_no}${bank.branch_code ? ' · Branch ' + bank.branch_code : ''} · Ref ${rec.reference || rec.number || rec.legacy_number || ''}`) : null,
    rec.terms ? h('div.dp-foot', rec.terms) : null,
    rec.signature ? h('div.dp-foot', h('img', { src: rec.signature, alt: 'Signature', style: 'height:60px' }), h('div', kind === 'quote' ? `Accepted by ${rec.approved_name || 'client'}` : 'Client signature')) : null,
    rec.total_override_reason ? h('div.dp-foot', { style: 'color:#b9770e' }, `⚠ ${rec.total_override_reason}`) : null);
}
