# Going live with Supabase

About an hour, done once by the owner or an administrator. When you finish, every staff member signs in with their own email, sees only what their role allows, and the agent runs at 05:00 and 05:30 even when nobody has the app open.

You need:

- a [Supabase](https://supabase.com) account; the free plan is enough to start, and Pro adds daily backups;
- the three zips: the app, the **private** data pack, and the **private** vault;
- the [Supabase CLI](https://supabase.com/docs/guides/cli) for step 6;
- `psql` (it comes with PostgreSQL) for loading the data. The SQL editor in the dashboard also works for every file except the 4 MB data file.

Keep the **service_role** key and the database password to yourself. They never go into the app, a chat message or an email.

## 1. Create the project

1. Supabase dashboard → **New project**. Choose region **Africa (Cape Town)** if offered; otherwise the nearest region. Save the database password in a password manager.
2. **Project Settings → API**: copy the **Project URL** and the **anon public** key. You need them in step 8.
3. **Project Settings → Database → Connection string (URI)**: copy it for `psql`.

## 2. Authentication settings

**Authentication → Providers → Email**:

- Turn **Allow new users to sign up** off. Staff accounts are created by an administrator only. Even if someone signs up, they get no access: every table requires a staff profile.
- Keep **Confirm email** on.

**Authentication → URL Configuration**: set **Site URL** to the address where the app will live (see [DEPLOY.md](DEPLOY.md)), for example `https://hq.landscapersinc.co.za`. Add the same address under **Redirect URLs**. Password-reset and sign-in links go there.

## 3. Create the database

Run the files **in this order**. Each one is safe to run again.

```bash
psql "<your connection string>" -f sql/01_schema.sql
```

```bash
psql "<your connection string>" -f sql/02_rls.sql
```

```bash
psql "<your connection string>" -f sql/03_triggers.sql
```

```bash
psql "<your connection string>" -f sql/04_storage.sql
```

```bash
psql "<your connection string>" -f sql/05_realtime.sql
```

| File | What it does |
|---|---|
| `01_schema.sql` | Every table (76 record types), indexes, and the role helper functions |
| `02_rls.sql` | Row Level Security on every table: the rules for who can read and change what (see [SECURITY.md](SECURITY.md)) |
| `03_triggers.sql` | Who and when on every record (cannot be faked), the audit log, profile protection, form-response categories |
| `04_storage.sql` | The private `drive` and `avatars` storage buckets and their access rules |
| `05_realtime.sql` | Live updates on every phone and PC |

To use the dashboard instead of `psql`: **SQL Editor → New query**, paste the whole file, and click **Run**.

## 4. Load the company data (private)

From `landscapers-inc-PRIVATE-data.zip`:

```bash
psql "<your connection string>" -f 06_seed.sql
```

This loads all 2,344 records (clients, sites, contracts, invoices, quotes, payments, staff, payroll, medicals, assets, fleet, forms and more). It runs in one transaction, so it loads completely or not at all. Re-running only refreshes records nobody has edited since.

This file is about 4 MB, which is too large for the dashboard SQL editor, so use `psql`.

## 5. Staff logins

The data pack contains the four people who had logins in the old CRM: Jared, Anthony, Renesh and Wayne. Each needs a Supabase login, which is then linked to their existing profile so their history stays attached to them.

1. **Authentication → Users → Add user → Create new user** for each person. Enter their email and a temporary password, and tick **Auto Confirm User**.
2. Open `sql/08_link_accounts.sql` and put their emails into the lines at the bottom. Jared's line is active; un-comment the others you created.
3. Run it:

   ```bash
   psql "<your connection string>" -f sql/08_link_accounts.sql
   ```

   Each line reports what it did. It is safe to run again.
4. Sign in to the app as the owner with the temporary password. You are asked to choose your own.

After that, add everyone else from **Admin → Users** in the app. It sends the invitation email through the `admin-users` function, so step 6 must be done first.

## 6. Edge Functions (server code)

```bash
supabase login
```

```bash
supabase link --project-ref <your project ref>
```

```bash
supabase functions deploy admin-users
```

```bash
supabase functions deploy send-email
```

```bash
supabase functions deploy ai-assistant
```

```bash
supabase functions deploy agent-run --no-verify-jwt
```

```bash
supabase functions deploy inbound-email --no-verify-jwt
```

| Function | What it does | Login check |
|---|---|---|
| `admin-users` | Invite, create, reset, suspend and delete staff logins (the only place the service key is used for people) | Caller must be signed in as owner or admin |
| `send-email` | Sends a message or invoice from Mail through Resend | Caller must be signed in |
| `ai-assistant` | Optional cloud mode for Sage AI (Claude) | Caller must be signed in |
| `agent-run` | The 24/7 agent: 05:00 dispatch, 05:30 briefing, debtor reminders, expiry watch | Secret header from the scheduler (`--no-verify-jwt` because the scheduler has no login) |
| `inbound-email` | Receives company email from your provider and files it into Mail with triage | Secret header from the provider (`--no-verify-jwt`) |

The `_shared` folder is included automatically.

### Secrets

Set them once. Anything left out simply switches that feature off.

```bash
supabase secrets set RESEND_API_KEY=<key from resend.com> MAIL_FROM="Landscapers Inc <accounts@your-domain.co.za>"
```

```bash
supabase secrets set CRON_SECRET=<long random string> INBOUND_SECRET=<another long random string>
```

```bash
supabase secrets set ANTHROPIC_API_KEY=<key from console.anthropic.com>
```

| Secret | Used by | Notes |
|---|---|---|
| `RESEND_API_KEY` | send-email, agent-run | Email sending. Verify your domain in Resend first |
| `MAIL_FROM` | send-email, agent-run | Sender address on a domain verified in Resend |
| `CRON_SECRET` | agent-run | The same value goes into Vault in step 7 |
| `INBOUND_SECRET` | inbound-email | Your email provider sends it as the `x-inbound-secret` header |
| `ANTHROPIC_API_KEY` | ai-assistant | Optional: without it Sage still answers everything from your data, just less conversationally |
| `ANTHROPIC_MODEL` | ai-assistant | Optional. Default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | ai-assistant | Optional: `low`, `medium` (default) or `high` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | agent-run | Optional WhatsApp reminders. Without them, WhatsApp messages wait in the approvals queue and are sent by hand with one tap |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. Never set them yourself.

To generate a random string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Incoming email (optional)

Point your provider's inbound webhook (Resend inbound, Postmark, Mailgun or a Cloudflare Email Worker) at:

```
https://<project ref>.supabase.co/functions/v1/inbound-email
```

Add the header `x-inbound-secret: <INBOUND_SECRET>`. Emergencies notify every manager straight away; quotes, reschedules and proofs of payment are sorted automatically.

## 7. The 24/7 schedule

1. **Database → Extensions**: enable `pg_cron` and `pg_net`.
2. **SQL Editor**, with the same value as `CRON_SECRET`:

   ```sql
   select vault.create_secret('<the CRON_SECRET value>', 'agent_cron_secret');
   ```

3. In `sql/07_cron.sql`, replace `<PROJECT_REF>` with your project ref, then run the file.

| Job | SAST | What it does |
|---|---|---|
| `agent-morning-dispatch` | 05:00 daily | Plans today's crew routes and postpones weather-affected visits |
| `agent-executive-briefing` | 05:30 daily | Writes the owner's briefing: overnight decisions, dispatch, approvals, money, alerts |
| `agent-payment-reminders` | Hourly, 07:00–18:00 | Debtor reminders at 3, 7 and 14 days overdue, and proof-of-payment matching |
| `agent-expiry-watch` | Hourly, 07:15–18:15 | Licences, certificates, medicals and documents nearing expiry |

Check it is working in the app under **Autonomous Core** (every run and decision is listed there), or in the Cron page of the Supabase dashboard. From the SQL editor:

```sql
select jobname, status, start_time, return_message from cron.job_run_details order by start_time desc limit 20;
```

## 8. Point the app at Supabase

In `js/config.js`:

```js
mode: 'supabase',
SUPABASE_URL: 'https://<project ref>.supabase.co',
SUPABASE_ANON_KEY: '<the anon public key>',
```

The anon key is meant to be public; Row Level Security protects the data. **Never** put the `service_role` key here.

Then publish the app ([DEPLOY.md](DEPLOY.md)) **without** the `data/seed/` folder.

## 9. Import the documents

Sign in as a manager, admin or owner → **Drive → Import document vault** → choose `landscapers-inc-PRIVATE-vault.zip`. Each original document is uploaded to private storage and attached to the record that already mentions it. Confidential documents and the FINANCE and HR drives stay restricted (see [SECURITY.md](SECURITY.md)).

## 10. Check it

- Sign in as the owner: the Daily Briefing, clients, invoices and calendar show the company's records.
- Sign in as a field worker: no payroll, medicals, bank accounts, FINANCE or HR drive, and no HR or incident form responses except their own.
- **Admin → System** shows the mode, versions, service worker, storage and notification status.

Developers can prove every rule before going live with `npm run test:sql`: it runs all of the SQL against real Postgres and checks access for eight roles.

## Updating later

- New app version: publish the new files. Phones pick them up on their next load.
- The schema changed (the release notes say so): run the new `sql/01`–`05` again. They are safe to re-run and never delete data.
