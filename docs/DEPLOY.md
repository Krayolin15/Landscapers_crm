# Putting the app online

The app is a set of static files, so any static host works. Do [SETUP-SUPABASE.md](SETUP-SUPABASE.md) first, and set `mode: 'supabase'` in `js/config.js`.

## Before you upload

- **Never upload `data/seed/`** or any `PRIVATE` zip. Once live, the company data lives in Supabase behind logins. A data pack on a web host can be downloaded by anyone who guesses the address. The `.gitignore` already excludes these folders from Git.
- The host must serve **HTTPS**. Phones need it for installing the app, offline use, the camera, GPS check-in and notifications. All three hosts below provide it free.
- Keep the two hidden files at the top of the folder: `.nojekyll` (GitHub Pages would otherwise drop files whose names start with `_`, such as `js/apps/_biz.js`) and `_headers` (security headers on Netlify and Cloudflare).

Upload these: `index.html`, `sw.js`, `manifest.webmanifest`, `.nojekyll`, `_headers`, and the `assets/`, `css/`, `js/` and `vendor/` folders. The `docs/`, `sql/`, `supabase/`, `tools/` and `tests/` folders are harmless but not needed by the browser.

## Option A: Netlify (simplest)

1. <https://app.netlify.com> → **Add new site → Deploy manually**.
2. Drag the prepared folder onto the page.
3. **Domain management**: add your own domain (for example `hq.landscapersinc.co.za`) or keep the free `…netlify.app` address.

To update, drag the new folder onto **Deploys**.

## Option B: Cloudflare Pages

**Workers & Pages → Create → Pages → Upload assets**, then upload the folder. Custom domains are under **Custom domains**.

## Option C: GitHub Pages

1. Create a **private** repository and push the app. `.gitignore` keeps `data/seed/` and `node_modules/` out.
2. **Settings → Pages → Deploy from a branch** → `main` / root.

GitHub Pages ignores `_headers`, so there are no extra security headers there; everything else works. Pages from a private repository needs a paid GitHub plan.

## After the first deploy

1. In Supabase, **Authentication → URL Configuration**: set **Site URL** to the live address and add it to **Redirect URLs**.
2. Open the address, sign in, and check **Admin → System**.

## Installing on phones and PCs

| Device | How |
|---|---|
| Android (Chrome) | Open the address → menu **⋮ → Install app** (or accept the install banner) |
| iPhone / iPad (Safari) | Open the address → **Share → Add to Home Screen** |
| Windows / Mac (Chrome or Edge) | The install icon in the address bar |

The installed app opens full screen, starts instantly, and keeps working with poor signal. Changes made offline are sent when the connection returns.

## Releasing an update

1. Upload the new files the same way.
2. Phones fetch the new code on their next load, because app code is loaded network-first. When a release changes the offline shell list, `VERSION` in `sw.js` is raised, which clears old caches.
3. If the release notes mention database changes, run the new `sql/01`–`05` in Supabase (safe to re-run, keeps all data).

## A custom domain for email

For invoices and reminders to come from your own address, verify the domain in [Resend](https://resend.com) (add the DNS records it shows), then set `MAIL_FROM` ([SETUP-SUPABASE.md](SETUP-SUPABASE.md#secrets)).
