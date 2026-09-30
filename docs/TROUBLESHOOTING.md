# Troubleshooting

## "Landscapers Inc. HQ could not start"

| Message | Fix |
|---|---|
| *The company data pack is not installed* | Local mode needs the private data: unzip `landscapers-inc-PRIVATE-data.zip` into `data/seed/` so that `data/seed/manifest.json` exists, then reload. (Supabase mode never needs this folder.) |
| The page was opened from a file (`file://`) | Browsers block the app's modules there. Run `node tools/serve.mjs 8080` and open <http://localhost:8080>, or use the hosted address |
| *Supabase library failed to load* | `vendor/supabase.min.js` is missing from the upload. Upload the whole `vendor/` folder |
| Anything else | Reload once. If it repeats, open the browser console (F12) and send the red error text to your administrator |

## Signing in

- **Forgot password**: in Supabase mode, use **Forgot password** on the sign-in screen, or ask an admin (**Admin → Users → Reset**). In local mode, an admin resets it under **Admin → Users**.
- **"This account is suspended"**: an admin must reactivate it.
- **The reset link opens the wrong site**: set the Site URL and Redirect URLs in Supabase (**Authentication → URL Configuration**) to the live address.
- **Signed in, but the lists are empty (Supabase)**: the login is not linked to a staff profile. Run `sql/08_link_accounts.sql` for imported staff, or add the person from **Admin → Users**.

## Someone can't see something

This is usually the permissions working as intended ([SECURITY.md](SECURITY.md)). Check the person's role under **Admin → Users**, and whether the item is:

- in the FINANCE or HR drive;
- marked confidential;
- an HR or incident form response;
- a restricted spreadsheet.

## Emails are not sending

- Mail shows *Email is not configured*: set the `RESEND_API_KEY` and `MAIL_FROM` secrets ([SETUP-SUPABASE.md](SETUP-SUPABASE.md#secrets)).
- Resend rejects the sender: the `MAIL_FROM` domain is not verified in Resend.
- Agent reminders stay *queued*: the same two secrets are missing for `agent-run`.
- WhatsApp reminders wait in **Autonomous Core → Approvals** until someone taps send, unless the Twilio secrets are set.

## The 05:00 / 05:30 agent did not run

1. In the Supabase SQL editor:

   ```sql
   select jobname, status, start_time, return_message from cron.job_run_details order by start_time desc limit 20;
   ```

2. *no agent_cron_secret in Vault*: create the Vault secret (step 7 of [SETUP-SUPABASE.md](SETUP-SUPABASE.md#7-the-247-schedule)).
3. HTTP 401 from `agent-run`: the Vault secret and the `CRON_SECRET` function secret differ, or the function was deployed without `--no-verify-jwt`.
4. HTTP 404: `<PROJECT_REF>` in `sql/07_cron.sql` was not replaced. Fix it and re-run the file.

While someone has the app open, the in-browser agent also runs the same jobs. **Autonomous Core** shows which agent ran each job.

## Phones show an old version

App code loads fresh on every start, so close the app completely and open it again. If it still looks old: browser settings → site settings → clear storage for the app's address, then open it again. Local-mode data lives in that storage, so export a backup first.

## Photos or documents do not open

- *File not uploaded yet*: the record points to an original document that has not been imported. A manager runs **Drive → Import document vault**.
- *You do not have access to the attachment*: the file is confidential or in a restricted drive.

## Spreadsheets

- A formula shows `#REF!`: it pointed at rows, columns or a tab that was deleted.
- `#NAME?`: an unknown function name. Type `=` and the first letters of a function to see matching names.
- Two people edited the same sheet: both sets of changes are kept. When you both changed the same cell, the last save wins, and the app says when someone else's edit arrives.

## For administrators and developers

```bash
npm test
```

```bash
npm run test:sql
```

```bash
npm run check
```

- `npm test` runs the unit tests.
- `npm run test:sql` checks the database scripts and every access rule.
- `npm run check` loads every module to find broken imports.
- **Admin → System** also has a built-in self-test.
