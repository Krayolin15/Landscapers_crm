# Security and privacy

Landscapers Inc. holds personal information about staff (ID numbers, bank details, medical fitness, disciplinary records) and clients. Under POPIA the company must keep it to the people who need it, protect it, and be able to show who did what. This page explains how the system does that.

## Where the protection lives

- **Once live (Supabase mode)**, every rule is enforced **by the database** with Row Level Security (`sql/02_rls.sql`). The app hides what a role cannot use, but even someone who bypasses the app with the public anon key gets nothing they are not allowed. `npm run test:sql` checks this against real Postgres for eight roles: 50 checks, including every rule below.
- **Local mode** keeps all data in one browser on one computer. It is for trying the system and for training, not for sensitive day-to-day use. Anyone who can use that computer's browser profile can reach the data.

## Roles

| Role | For | Typical access |
|---|---|---|
| owner | Director | Everything, including deleting accounts |
| admin | General Manager | Everything except deleting accounts |
| manager | Operational Manager | All business records, HR, finance and approvals |
| finance | Bookkeeping | Invoices, payments, expenses, payroll, the FINANCE drive |
| hr | HR / SHEQ | Staff, medicals, HR actions, HR and incident forms, the HR drive |
| sales | Sales | Leads, quotes, clients, invoices (to create them) |
| operations | Operations | Dispatch, jobs, fleet, assets, incident forms |
| supervisor | Team leaders | Their crews' visits, check-ins, PPE, field invoices |
| field | Field staff | Their own day: visits, forms, chat, calendar |
| viewer | Read-only | Look but not change |

**Admin → Roles** adjusts which apps and screens each role is offered, and the owner and admin cannot be locked out. What the database itself allows comes from `perms` in `js/schema/`. To change that, edit it there, run `npm run sql`, and apply `sql/02_rls.sql`.

## Who can see what

| Information | Who |
|---|---|
| Payroll, deductions | manager, finance, hr |
| Medicals, HR actions (warnings, counselling, grievances) | manager, hr |
| Staff ID numbers, passport, date of birth, address, next of kin, pay rate, bank details | manager, hr, finance. Other roles that use staff records see the record without these fields |
| Certificate ID numbers | manager, hr |
| Contract values, job value, cost, profit, amounts owing | manager, finance, sales, operations |
| Expenses, financial periods, owner funding, payments | manager, finance |
| Leads, prospects, call history | manager, sales (leads also finance) |
| Audit log | owner, admin, manager |
| **FINANCE drive** | owner, admin, manager, finance, plus anyone added as a member |
| **HR drive** | owner, admin, manager, hr, plus anyone added as a member |
| **Confidential files** (the lock flag) | manager, hr, and whoever uploaded the file |
| **HR form responses** (grievance, warning, counselling) | the person who submitted, manager, hr |
| **Incident form responses** | the person who submitted, manager, hr, operations |
| Spreadsheets built from restricted records (payroll, budgets, timesheets) | the roles allowed to read those records, and whoever made the sheet |
| Private calendar events, private notes, private chat spaces | the owner of the item, its attendees or members |
| Mail | the sender and recipients (owner and admin can audit) |

Values are hidden where the data is stored, not just on the screen:

- **Sensitive fields** can never be read from their table. Allowed roles receive them through a separate protected view (`<table>_sensitive`).
- **Stored documents** (PDFs, photos) can only be downloaded by someone who can see the matching file record, so the confidential flag and the drive restrictions also cover the actual file.
- An **HR or incident form response** takes its category from the form, set by the database, so it cannot be relabelled to make it public. Photos attached to those forms are marked confidential automatically.
- Someone who cannot open a restricted drive also cannot upload into it or file records there.
- **Form drafts** on a phone belong to one person and are deleted when they sign out; the app warns first.

## Who did what (audit trail)

- Every record carries **created by / when** and **last changed by / when**. The database sets these from the login, so they cannot be faked. This is how the calendar shows, for example, that Wayne added the 10:00 meeting on 10 September.
- Every create, change, delete and restore is written to the **audit log** with the exact fields changed. Nobody can write to it or edit it directly (**Admin → Audit log**).
- Deleting moves a record to the trash, where it can be restored. Only managers and above delete permanently, and only the owner deletes staff accounts.

## Keys and secrets

| Key | Where it may be | Where it must never be |
|---|---|---|
| Supabase **anon** key | `js/config.js` (it is public by design; RLS protects the data) | none |
| Supabase **service_role** key | Only inside Supabase, where Edge Functions receive it automatically | The app, Git, email, chat |
| Database password | Password manager | Anywhere else |
| `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `INBOUND_SECRET`, Twilio | Supabase secrets (`supabase secrets set`) | The app, Git |

The server functions check the caller themselves:

- `admin-users` accepts owner and admin only, and deleting accounts is owner only.
- `send-email` sends only the caller's own messages, only attachments the caller may open, and outbox items only for owner, admin, manager, finance and sales.
- `agent-run` and `inbound-email` require their secret header.
- No privileged database function can be called through the API; the scheduler helper is revoked from every API role.

## Sign-in

- The four imported staff accounts start with the passwords from the old CRM and **must** choose a new password at first sign-in.
- The screen locks after 45 minutes without activity (`idleTimeoutMinutes` in `js/config.js`).
- Suspended accounts cannot sign in, and cannot use a still-open session to send email.
- Public sign-up is switched off (see [SETUP-SUPABASE.md](SETUP-SUPABASE.md#2-authentication-settings)). Even an account created some other way has no access without a staff profile.

## Sage AI and your data

- Sage answers from the records **you** may read, computed on your device.
- The optional cloud mode (`ai-assistant`) sends only those computed facts and your question to Claude. It does not send the database. The Anthropic key stays in Supabase. Each person switches cloud mode on for themselves.

## Personal information (POPIA) notes

- **Medical records**: only the fitness outcome and expiry are stored in the system. Clinical details from the source documents were deliberately **not** transcribed. They remain only in the original documents, which are confidential in the HR drive.
- **Data pack and vault zips**: keep them offline (encrypted drive or password manager attachment) once imported, and do not email them.
- **Access requests and corrections**: every person's records are listed together under **Employees** or **Clients**, and the audit log shows every change, which supports responding to a POPIA request.
- **Backups**: Supabase Pro keeps daily backups. **Admin → Backup** exports a copy on demand; store it like the data pack.

## Reporting a problem

If you think someone has seen something they should not have: suspend the account (**Admin → Users**), check **Admin → Audit log** for what they changed, and contact the owner.
