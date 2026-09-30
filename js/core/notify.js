/* =============================================================================
   Notifications & reminders.

   notify(userIds|'all'|role list, { title, body, icon, tile, link, kind, source_key })
   startReminders()  — runs every CONFIG.reminderTickSeconds while the app is open:
     1. Calendar reminders (per event, e.g. 30 min + 1 day before) -> toast, browser
        notification and an entry in the bell inbox. Fired once per occurrence.
     2. Business alerts from registered sources (certificates expiring, invoices
        overdue, vehicle services due, follow-ups...) -> one notification per key
        per person, re-raised when severity escalates.
   registerAlertSource(fn) — apps add sources: fn() -> [{ key, title, body, link,
        due (ISO date), severity:'info'|'warn'|'danger', roles:[...]|'*', icon, tile }]
   In Supabase mode the same reminders are also emailed by the scheduled Edge
   Function (supabase/functions/reminders) so people are reminded even when the
   app is closed.
   ========================================================================== */

import { CONFIG } from '../config.js';
import { db } from './db.js';
import { idb } from './idb.js';
import { store, bus } from './bus.js';
import { expand } from './recurrence.js';
import { today, addDays, at, nowSA } from './dates.js';
import * as fmt from './format.js';
import { toast } from '../ui/overlays.js';

const sources = [];
let timer = null;
let fired = null;

export function registerAlertSource(fn) { sources.push(fn); }

export async function notify(to, n) {
  const profiles = db.all('profiles').filter(p => p.status !== 'suspended');
  let ids;
  if (to === 'all') ids = profiles.map(p => p.id);
  else if (Array.isArray(to) && to.every(x => typeof x === 'string' && profiles.some(p => p.role === x)) && !to.some(x => profiles.some(p => p.id === x))) ids = profiles.filter(p => to.includes(p.role) || ['owner', 'admin'].includes(p.role)).map(p => p.id);
  else ids = [].concat(to).filter(Boolean);
  const created = [];
  for (const user_id of [...new Set(ids)]) {
    if (n.source_key && db.find('notifications', x => x.user_id === user_id && x.source_key === n.source_key)) continue;
    created.push(await db.insert('notifications', { user_id, title: n.title, body: n.body || '', icon: n.icon || 'bell', tile: n.tile || 't-forest', link: n.link || null, kind: n.kind || 'info', source_key: n.source_key || null }, { skipValidate: true, silent: true }));
  }
  return created;
}

export function unreadCount(userId = (store.get('user') || {}).id) {
  return db.all('notifications').filter(n => n.user_id === userId && !n.read_at).length;
}

export async function markAllRead(userId = (store.get('user') || {}).id) {
  const now = new Date().toISOString();
  for (const n of db.all('notifications').filter(x => x.user_id === userId && !x.read_at)) await db.update('notifications', n.id, { read_at: now }, { skipValidate: true, silent: true });
}

export function browserNotify(title, body, link) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', tag: title + body });
    n.onclick = () => { window.focus(); if (link) location.hash = link.replace(/^#/, ''); n.close(); };
  } catch { /* some mobile browsers only allow notifications from the service worker */ }
}
export async function requestBrowserPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

async function loadFired() {
  if (fired) return fired;
  const arr = (await idb.kvGet('reminders.fired')) || [];
  fired = new Set(arr.slice(-3000));
  return fired;
}
async function markFired(key) { fired.add(key); await idb.kvSet('reminders.fired', Array.from(fired).slice(-3000)); }

async function tick() {
  const me = store.get('user');
  if (!me) return;
  await loadFired();
  const now = nowSA();
  const from = today(), to = addDays(from, 8);

  // 1. calendar reminders for events I created or attend (or company-wide ones)
  const mine = db.all('events').filter(e => e.visibility !== 'private' || e.created_by === me.id || (Array.isArray(e.attendees) && e.attendees.includes(me.id)));
  for (const occ of expand(mine, addDays(from, -1), to)) {
    const ev = occ.event;
    const involved = ev.created_by === me.id || (Array.isArray(ev.attendees) && ev.attendees.includes(me.id)) || !(ev.attendees && ev.attendees.length);
    if (!involved) continue;
    const reminders = Array.isArray(ev.reminders) ? ev.reminders : CONFIG.defaultEventReminders;
    const startAt = at(occ.date, occ.start_time || '07:00');
    for (const mins of reminders) {
      const due = new Date(startAt.getTime() - mins * 60000);
      const key = `ev|${me.id}|${occ.key}|${mins}`;
      if (now >= due && now - due < 36 * 3600e3 && now < new Date(startAt.getTime() + 3600e3) && !fired.has(key)) {
        await markFired(key);
        const when = occ.start_time ? `${fmt.date(occ.date, 'dow')} at ${occ.start_time}` : fmt.date(occ.date, 'dow');
        const title = `${ev.title}`;
        const body = `${mins >= 1440 ? 'Tomorrow' : mins >= 60 ? `In ${Math.round(mins / 60)} h` : `In ${mins} min`} · ${when}${ev.location ? ' · ' + ev.location : ''} · added by ${ev.created_by_name || 'someone'}`;
        await notify([me.id], { title: `⏰ ${title}`, body, icon: 'alarm-clock', tile: 't-river', link: `#/calendar/event/${ev.id}?d=${occ.date}`, kind: 'reminder', source_key: key });
        toast(title, { kind: 'info', icon: 'alarm-clock', text: body, ms: 9000, action: { label: 'Open', onClick: () => (location.hash = `#/calendar/event/${ev.id}?d=${occ.date}`) } });
        browserNotify(`Reminder: ${title}`, body, `#/calendar/event/${ev.id}`);
      }
    }
  }

  // 2. my tasks due today / overdue — one digest per day
  const dayKey = `tasks|${me.id}|${from}`;
  if (!fired.has(dayKey) && now.getHours() >= 7) {
    const due = db.all('tasks').filter(t => t.assignee_id === me.id && t.status !== 'done' && t.due_date && t.due_date <= from);
    if (due.length) {
      await markFired(dayKey);
      await notify([me.id], { title: `${due.length} task${due.length === 1 ? '' : 's'} due`, body: due.slice(0, 3).map(t => t.title).join(' · '), icon: 'list-todo', tile: 't-sun', link: '#/tasks', kind: 'task', source_key: dayKey });
    }
  }

  // 3. business alerts
  for (const src of sources) {
    let alerts = [];
    try { alerts = (await src()) || []; } catch (e) { console.warn('alert source failed', e); }
    for (const a of alerts) {
      const allowed = !a.roles || a.roles === '*' || a.roles.includes(me.role) || ['owner', 'admin'].includes(me.role);
      if (!allowed) continue;
      const key = `al|${me.id}|${a.key}|${a.severity || 'info'}`;
      if (fired.has(key)) continue;
      await markFired(key);
      await notify([me.id], { title: a.title, body: a.body, icon: a.icon || (a.severity === 'danger' ? 'octagon-alert' : 'triangle-alert'), tile: a.tile || (a.severity === 'danger' ? 't-rose' : a.severity === 'warn' ? 't-sun' : 't-river'), link: a.link, kind: 'alert', source_key: key });
    }
  }
  bus.emit('notifications:tick');
}

export function startReminders() {
  if (timer) return;
  setTimeout(tick, 2500);
  timer = setInterval(tick, CONFIG.reminderTickSeconds * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
export function stopReminders() { clearInterval(timer); timer = null; }

/** Collect current alerts from all sources without notifying (Home "Needs attention" panel). */
export async function currentAlerts() {
  const me = store.get('user');
  const all = [];
  for (const src of sources) {
    try { all.push(...((await src()) || [])); } catch { /* ignore */ }
  }
  return all.filter(a => !a.roles || a.roles === '*' || (me && (a.roles.includes(me.role) || ['owner', 'admin'].includes(me.role))))
    .sort((a, b) => ({ danger: 0, warn: 1, info: 2 }[a.severity || 'info'] - { danger: 0, warn: 1, info: 2 }[b.severity || 'info']) || String(a.due || '').localeCompare(String(b.due || '')));
}
