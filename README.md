# Landscapers Inc. HQ

The company's own workspace and CRM: mail, calendar, drive, docs, sheets, slides, forms, chat and meetings, plus clients, leads, quotes, invoices, payments, live dispatch, fleet, people, health and safety, finance, KPIs, an AI assistant (Sage) and a 24/7 autonomous agent. It is plain HTML, CSS and JavaScript with no build step. Supabase provides the shared database, logins, file storage and the always-on agent.

Built for Landscapers Inc., Mount Edgecombe, Durban. Times are South African (SAST), money is in rand, and the calendar includes the South African public holidays.

## What you received

| File | What it is | Who may have it |
|---|---|---|
| `landscapers-hq-app.zip` | The app: code, database scripts, Edge Functions, tools, tests and these docs. **It holds no company data.** | Safe to keep in a (private) code repository |
| `landscapers-inc-PRIVATE-data.zip` | The company data pack: every record taken from the company files (clients, invoices, staff, payroll, medicals and more), plus `06_seed.sql` to load it into Supabase | **Private.** Owner and administrator only. Never upload it to a website or a public repository |
| `landscapers-inc-PRIVATE-vault.zip` | The original documents (PDFs, spreadsheets, photos), filed into the shared drives | **Private.** Import it inside the app, then store the zip offline |

## Try it on one computer (local mode)

Everything runs in one browser, and nothing leaves that computer. Use this to look around or to train staff before going live.

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. Unzip `landscapers-hq-app.zip`.
3. Unzip `landscapers-inc-PRIVATE-data.zip` into the app's `data/seed/` folder, so that `data/seed/manifest.json` exists.
4. In the app folder, run:

   ```bash
   node tools/serve.mjs 8080
   ```

5. Open <http://localhost:8080>. The first start loads the company records, which takes a few seconds.
6. Tap your name and sign in with the password you used in the old CRM. You will be asked to choose your own password.
7. To attach the original documents: **Drive → Import document vault**, then choose `landscapers-inc-PRIVATE-vault.zip`. This needs a manager, admin or owner.

Local mode keeps its data in that browser's storage. Clearing the browser's site data erases it; **Admin → Backup** exports a copy.

> Do not put local mode with the data pack on a public website. Anything in `data/seed/` could then be downloaded by anyone. For use across phones and PCs, go live with Supabase instead.

## Go live (Supabase)

This gives everyone their own login, one shared database protected by Row Level Security, file storage, realtime updates, email, and the agent running at 05:00 and 05:30 every day even when nobody is signed in.

1. [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md): create the project, run the SQL files in order, load the private data, link the staff logins, and deploy the Edge Functions and secrets.
2. [docs/DEPLOY.md](docs/DEPLOY.md): put the app online (GitHub Pages, Netlify or Cloudflare Pages) and install it on phones.
3. Set `mode: 'supabase'`, `SUPABASE_URL` and `SUPABASE_ANON_KEY` in [js/config.js](js/config.js). This is the only file you edit.

## Documentation

| | |
|---|---|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | For staff: every app, and the everyday tasks step by step |
| [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md) | Going live: database, logins, storage, Edge Functions, secrets, schedule |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Hosting, updates, installing on phones |
| [docs/SECURITY.md](docs/SECURITY.md) | Who can see what, keys, POPIA, audit trail |
| [docs/DATA-PACK.md](docs/DATA-PACK.md) | What was taken from the company files and how it was checked |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | When something does not work |
| [docs/CONTRACT.md](docs/CONTRACT.md) | Developer reference: record formats, app modules, extension points |

## Project layout

```
index.html, sw.js, manifest.webmanifest   the app shell, offline cache, phone install
css/                 design tokens, layout, components, animations
js/config.js         the only settings file
js/core/             data layer (IndexedDB / Supabase), auth, permissions, dates, money, search
js/ui/               shell, components, forms, tables, charts, overlays
js/schema/           every record type and its permissions (the source for the SQL)
js/apps/<app>/       one folder per app (index.js = screens, plugin.js = badges, alerts, Sage skills)
js/ai/               Sage: skills, entity extraction, answers
sql/                 01–05 generated from js/schema, 07 schedule, 08 link logins
supabase/functions/  Edge Functions: admin-users, send-email, inbound-email, agent-run, ai-assistant
tools/               local server, SQL/seed generators, checks and tests
tests/               unit tests (npm test)
vendor/              pinned third-party libraries (no CDN needed)
data/seed/           the private data pack goes here (not included in the app zip)
```

## For developers

No build step. The tools are optional and need only Node.js.

```bash
npm install
```

```bash
npm test
```

```bash
npm run test:sql
```

```bash
npm run check
```

- `npm test` runs the unit tests: formulas, money, dates, forms, Sage, agent rules and more.
- `npm run test:sql` runs every SQL file against a real Postgres (PGlite), loads the data pack if it is in `data/seed/`, links logins, and checks Row Level Security for eight roles.
- `npm run check` loads every module and reports import or syntax errors.
- `npm run sql` regenerates `sql/01`–`05` after you change `js/schema/`. Never edit those files by hand.
- `npm run seed -- --knowledge <dir>` rebuilds the data pack from the extracted company knowledge files.
