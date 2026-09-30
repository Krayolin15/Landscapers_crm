# Landscapers Inc. HQ — developer contract

Every app in `js/apps/<id>/` is built against this contract so the whole system
behaves as one product. Read it fully before writing an app. **Read the core
files you use** (they are short and commented) — this document is the index,
the code is the truth.

Stack: static HTML + CSS + vanilla ES modules (no build step, no npm at runtime),
Supabase (Postgres + Auth + Storage + Realtime + Edge Functions) in production,
IndexedDB in local mode. Deployable to GitHub Pages / Netlify as-is.

---

## 1. Layout

```
index.html                 shell page (CSP, fonts, vendored libs, css)
css/tokens.css             colours, type, radii, shadows, motion (light + dark)
css/base.css               reset, living aurora background, utility classes
css/animations.css         keyframes + .anim-in/.stagger/.skeleton/... helpers
css/layout.css             top bar, sidebar, launcher, panels, bottom nav, FAB
css/components.css         cards, buttons, forms, badges, tables, tabs, modals, kanban, timeline...
js/config.js               the only file edited to go live
js/main.js                 boot
js/core/                   db, idb, schema, validate, auth, perms, router, bus, money, dates,
                           holidays, recurrence, format, files, notify, search, seed
js/schema/workspace.js     workspace collections (profiles, events, mail, chat, drive, docs...)
js/schema/business.js      business collections (clients, invoices, employees...)
js/ui/                     dom (h), icons, components, overlays, table, form, entity, charts,
                           animate, sanitize, shell, login
js/ml/                     core (split, metrics, encoder), models, engine (tasks, training, predictions)
js/apps/<id>/index.js      the app (routes)             ← you write these
js/apps/<id>/plugin.js     badges, quick-create, alerts, search actions, ML tasks  ← and these
js/apps/<id>/style.css     optional app styles (load with ensureStyle)
js/apps/registry.js        list of apps (id, name, icon, tile, group, roles)
vendor/                    Chart.js, jsPDF(+autotable), SheetJS (XLSX), JSZip, Lucide icons,
                           canvas-confetti, signature_pad, Leaflet, supabase-js — all pinned & local
data/seed/                 company data pack (JSON per collection + manifest.json)
sql/                       Supabase schema, RLS, functions, storage, seed
supabase/functions/        Edge Functions (send-email, ai-assistant, admin-users, reminders)
tests/                     node unit tests + browser smoke tests
tools/                     serve.mjs, gen-sql.mjs, check.mjs, build-seed.mjs, hash.mjs
```

## 2. An app module

```js
// js/apps/calendar/index.js
import { h, ensureStyle } from '../../ui/dom.js';
export default {
  id: 'calendar',
  fullWidth: false,                         // true = no max-width container
  routes: {
    '':            ctx => view(ctx),        // #/calendar
    'event/:id':   ctx => eventPage(ctx),   // #/calendar/event/abc
    'week/:date':  ctx => ...
  },
  detail: {                                 // optional: owns #/record/<collection>/<id>
    events: (id, ctx) => eventPage({ ...ctx, params: { id } })
  }
};
```
`ctx = { appId, params, query, path, dispose, user, navigate, setTitle, refresh }`.
A handler returns a Node (or Promise<Node>). **Register every clean-up** with
`ctx.dispose.add(fn)`: `db.on()` unsubscribers, intervals, Chart instances
(`chart({... dispose: ctx.dispose})` does it for you), document listeners.

```js
// js/apps/calendar/plugin.js  — runs once at startup for every signed-in user
import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerAction } from '../../core/search.js';
export default function () {
  registerBadge('calendar', () => ({ n: todayCount(), hot: false }));        // sidebar count
  registerCreate({ id: 'new-event', label: 'Event', icon: 'calendar-plus', group: 'Workspace', app: 'calendar', run: () => openEventForm() });
  registerAlertSource(() => [...]);                                           // see §7
  registerAction({ id: 'cal-today', label: 'Show today in the calendar', icon: 'calendar', keywords: 'today agenda', app: 'calendar', run: () => (location.hash = '#/calendar') });
}
```
Keep `plugin.js` light (no heavy imports) — it runs at boot. Every app folder
**must** have a `plugin.js` (it may export an empty function).

## 3. Data — `js/core/db.js`

```js
db.all(col)                        // live records (sync, cached)
db.get(col, id)                    // one or null
db.list(col, { where, sort:'-date', search:'text', limit })
db.filter(col, pred) / db.find(col, pred) / db.count(col, pred)
db.label(col, recOrId)             // display name via schema.display
db.check(col, values, {id})        // validate only -> {ok, errors, warnings, rec}
await db.insert(col, values)       // validates, stamps id/created_by/created_by_name/created_at, audits
await db.update(col, id, patch)    // validates, stamps updated_by..., audits with a field diff
await db.remove(col, id)           // soft delete -> Trash (deleted_at). {hard:true} to purge
await db.restore(col, id)
await db.bulkUpsert(col, rows, { validate, silent })
db.on(col | '*', ({type, rec, prev, remote}) => ...)   -> unsubscribe
```
* **Every write goes through `db`.** Never write IndexedDB or Supabase directly.
* Writes throw `ValidationError` (`e.errors = {field: message}`) — show them with
  `showError(e)` or inline via the form engine.
* Every record carries `created_by / created_by_name / created_at` and
  `updated_by…` — **always show attribution** on things people add (events,
  notes, comments, tasks, files, form responses, invoices…): use
  `attribution(rec)` → "Added by Wayne · 2 Sep". This is a core requirement.
* Imported company records have `_seed: true` and `_src: "<file> | <sheet/page>"`
  (provenance). Show `_src` on detail pages ("Source document").
* The signed-in user: `store.get('user')` → `{ id, name, role, email, color, employee_id }`.

## 4. Schema — `js/core/schema.js`, `js/schema/*.js`

One definition per collection drives validation, forms, tables, search, SQL and RLS.
Field types: `text longtext richtext email phone url int number money percent rating
date datetime time bool enum multi tags ref refs json file files color sa_id
company_reg vat_number tax_ref bank_account branch_code signature`.
Field options: `label required recommended unique default options ref softRef min
max precise minLength maxLength pattern patternHint hint placeholder group list
hidden readonly sensitive computed notFuture notPast strict:false wide`.
Collection options: `label singular icon tile app display(rec) subtitle(rec) search:[..]
sort perms:{read,write,delete} sensitiveRoles rules:[(rec,ctx)=>{field,message,level}]
defaults beforeSave(rec, prev)`.
Dates are `'YYYY-MM-DD'`, times `'HH:MM'`, timestamps ISO strings, money numbers in rand.

## 5. Permissions — `js/core/perms.js`
`can('write','invoices')`, `canApp('finance')`, `canSeeField(col, field)`,
`isAdmin()`, `isManager()`, `isField()`. Hide what a role cannot do; RLS enforces
it server-side. Roles: owner, admin, manager, finance, hr, sales, operations,
supervisor, field, viewer.

## 6. UI kit

```js
import { h, $, $$, mount, clear, debounce, uid, downloadBlob, downloadText, toCSV, copyText, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';              // icon('calendar-days', 18) — any Lucide name
import { btn, busy, badge, statusBadge, avatar, avatarStack, attribution, card, kpiTile, sparkline,
         progress, ring, tabs, seg, emptyState, skeleton, pageHeader, kv, listItem, callout,
         searchBox, dot } from '../../ui/components.js';
import { modal, drawer, confirm, prompt, toast, showError, menu } from '../../ui/overlays.js';
import { dataTable } from '../../ui/table.js';
import { schemaForm, openRecordForm, fieldInput, refPicker } from '../../ui/form.js';
import { entityListPage, entityDetailPage, fieldValue, recordLink, recordComments, recordHistory, recordFiles, detailsGrid } from '../../ui/entity.js';
import { chart, palette, resolveColor } from '../../ui/charts.js';
import { countUp, celebrate, typewriter, slideToggle } from '../../ui/animate.js';
import { sanitizeHTML, sanitizeToFragment, htmlToText } from '../../ui/sanitize.js';
```
* **Never assign user data to `innerHTML`.** Build with `h()`. Rich text:
  `h('div', { html: storedHtml })` (sanitised automatically) and store with
  `sanitizeHTML()`.
* `h('div.card.hover#x', { onClick, style:{...}, dataset:{...}, class:[..] }, ...children)`.
* Page skeleton: `pageHeader({ title, sub, icon, tile, actions, crumbs })` then
  content. KPI rows: `h('div.grid.cols-4.stagger', kpiTile(...)...)`.
* Tables: `dataTable({...})` (search, filters, sort, paging, CSV/Excel export,
  bulk actions, totals row, mobile card layout).
* Record CRUD: `openRecordForm(col, { id?, values?, fields? })`, generic pages:
  `entityListPage`, `entityDetailPage` (tabs for details, related records,
  files, comments, history are automatic). Specialise where it helps.
* Charts: `chart({ type:'line'|'bar'|'doughnut', labels, series:[{label,data,color,fill}], money:true, dispose: ctx.dispose })`.
* Celebrate real wins (invoice paid, deal won, goal hit): `celebrate()`.
* Tiles/colours: classes `t-forest t-grass t-river t-sky t-clay t-sun t-rose t-violet t-slate t-brand t-aurora`;
  badge colours `green forest blue gold clay red violet gray`.

## 7. Cross-cutting services
* **Money** (`core/money.js`): `toCents, parseMoney, lineTotal(qty, unit, disc%)`
  (keeps unrounded per-visit rates, rounds once), `documentTotals(lines, {vatRegistered})`,
  `sum, sumBy, formatMoney`. Never add money with floats yourself.
* **Format** (`core/format.js`): `money, moneyCompact, num, pct, date(v,'long'|'full'|'short'|'dow'|'numeric'),
  time, dateTime, relative, dueLabel, phone, phoneIntl, initials, titleCase, plural, fileSize, duration, greeting`.
* **Dates** (`core/dates.js`): `today, nowSA, iso, parse, addDays, addMonths, diffDays,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, monthGrid, range, at, isoWeek, parseLoose, MONTHS, DAYS`.
* **SA holidays** (`core/holidays.js`): `holidaysBetween(a,b)`, `holidayOn(date)`,
  `isPublicHoliday`, `isWorkingDay`, `nextWorkingDay`, `workingDaysBetween`.
* **Recurrence** (`core/recurrence.js`): `occurrences(ev, from, to)`, `expand(events, from, to)`, `describe(ev)`.
* **Notifications & reminders** (`core/notify.js`): `notify(userIds|'all'|[roles], {title, body, icon, tile, link, kind, source_key})`,
  `registerAlertSource(() => [{ key, title, body, link, due, severity:'info'|'warn'|'danger', roles, icon, tile }])`,
  `currentAlerts()`. Alert keys must be stable (e.g. `cert-expiry|<id>|30d`).
* **Search** (`core/search.js`): records are searched automatically from schema
  `search` fields; add quick actions with `registerAction`.
* **Files** (`core/files.js`): `uploadFiles(files, { drive_id, folder_id, linked:[{collection,id}] })`,
  `openFile(rec)`, `downloadFile(rec)`, `getBlob`, `fileUrl`, `filesFor(col,id)`, `fileIcon(rec)`, `attachBytes`.
* **Calendar sources** (`core/calendar-sources.js`): every app with dates puts them
  on the shared Calendar automatically: `registerCalendarSource({ id, label, color, icon, app, defaultOn, items(from, to) -> [{ id, date, end_date?, time?, title, subtitle?, link, category, color? }] })`.
  The Calendar app renders them next to people's own events (SA holidays are built in).
  Register in your app's `plugin.js`.
* **Sage AI skills** (`ai/skills.js`): teach the assistant to answer questions about
  your data: `registerSkill({ id, app, label, examples, keywords, match?, run(q, ents, ctx) -> Answer })`
  — see the file header for the Answer format (text + cards + actions). Answers are
  computed from live records only. Register in `plugin.js` (import lazily inside `run`).
* **Machine learning** (`ml/engine.js`): `defineTask({...})`, `defineForecast({...})`,
  `train(key)`, `predict(key, rec)`, `logPrediction`, `runForecast(key)`,
  `latestModel`, `modelHistory`, `liveAccuracy`. Define business tasks in the
  owning app's `plugin.js`. Always show the model's test metrics next to a
  prediction and say "not enough data yet" honestly when untrained.

## 8. Quality bar (non-negotiable)
1. **Data correctness first.** Never fabricate business data. Every number shown
   must be computed from records. If data is missing, say so (empty state /
   "not captured yet"), never invent. Demo/sample rows (if any) must carry
   `is_demo: true`, a visible badge, and never touch financial collections.
2. **Alive UI**: page enters with `.page-enter` (router does it), cards/tiles in
   `.stagger` grids, hover lift on cards, animated counters in KPI tiles, skeletons
   while loading, meaningful empty states with an icon and a call to action,
   `celebrate()` on real wins. Respect reduced motion (built into the CSS).
3. **Mobile first**: every screen works at 375 px wide with no horizontal page
   scroll (tables use `.table.responsive` automatically; use `.grid.cols-*`
   which collapse). Touch targets ≥ 40 px. Field flows (invoice on site, visit
   check-in, incident report, checklist) must be one-hand friendly.
4. **Consistency**: use the components above; do not invent new button/card
   styles. App CSS only for layout unique to that app (calendar grid, mail list,
   sheet grid...), using tokens (`var(--primary)`, `var(--r-lg)`, ...).
5. **Accessibility**: labels on inputs, `aria-label` on icon buttons, keyboard
   support (Enter/Esc), focus visible, colour never the only signal.
6. **Security**: no `innerHTML` with data, no `eval`, no inline event attributes,
   no new network hosts (CSP), no secrets in JS. Server-only work goes in Edge Functions.
7. **Every write is attributed** and every destructive action confirms and goes
   to Trash (soft delete) unless purging deliberately.
8. **No dead ends**: every list links to detail, every detail links back and to
   related records (`recordLink(col,id)`), every alert links to the fix.
9. **Test what you build**: pure logic gets a `tests/<app>.test.mjs` (node, no
   DOM). Run `node tools/check.mjs` (parses every module & verifies imports)
   before you finish.

## 9. Shared data formats (seeded records already use these — keep them)

* **`forms.questions`** — an ordered array. Each item:
  `{ id, type, label, help?, required?, options?, rows?, columns?, scale?, min?, max?, show_if?: { question, equals } }`
  where `type` is one of `section` (header + help text, no answer), `text`, `paragraph`, `number`, `money`,
  `date`, `time`, `datetime`, `yesno`, `checkbox` (single tick), `choice` (one of `options`), `checkboxes`
  (many of `options`), `dropdown`, `scale` (`min`..`max`), `rating`, `grid` (a checklist grid: `rows` × `columns`,
  each cell one of `scale.options`, e.g. the H&S risk key 1–5), `photo`, `file`, `signature`, `gps`,
  `employee`, `client`, `site`, `vehicle`, `asset` (record pickers). `form_responses.answers` is an object
  keyed by question id (grid answers: `{ [row]: { [column]: value } }`).
* **`docs.content`** — sanitised HTML (`h2`–`h4`, `p`, `ul/ol/li`, `table`, `strong/em/u`, `a`, `img`); `docs.text`
  holds the plain text for search. Imported policies/SOPs are `locked: true` with `doc_code`, `revision`,
  `effective_date`, `review_date`.
* **`invoices.reminders_sent`** — `[{ day: 3|7|14, at, via, by }]`; **`outbox`** — `{ channel, to, to_name, subject, body,
  status, sent_at, related_collection, related_id }`. Invoice status comes from `invoiceState()` in `js/apps/_biz.js`.
* **Seeded records** carry `_seed: true` and `_src` (source file + location). Never strip `_src`.
