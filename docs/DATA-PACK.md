# The company data pack

`landscapers-inc-PRIVATE-data.zip` holds every record taken from the company files, ready for the app: the JSON files for local mode, and `06_seed.sql` for Supabase. This page describes what is in it without repeating any of the private content.

## Where it came from

The company data zip was read file by file: the CRM and sales workbooks, invoices (April to July), income statements, KPI trackers, schedules and operations registers, staff and HR files, medicals, training records, fleet, assets and purchases, health and safety forms and policies, SOPs, strategy documents, marketing material, and the old CRM's own data. Nested zips were opened too. The facts were extracted into 37 structured knowledge files. `tools/build-seed.mjs` then maps them into the app's record types, with one mapper per area in `tools/seed/`.

**Every record carries `_src`**, the source file (and sheet, row or page) it came from, so any value can be traced back to the original document.

## Contents (version `c5f9e33d90d1`: 2,344 records, 50 record types)

| Area | Records |
|---|---|
| Clients 63 · sites 57 · contracts 57 · contract changes 2 · contacts 7 | 186 |
| Visits 201 · crews 2 · calendars 2 · events 53 · tasks 14 | 272 |
| Leads 174 · prospects 82 · call attempts 79 | 335 |
| Quotes 32 · invoices 89 | 121 |
| Services 46 · design options 13 · references 3 | 62 |
| Jobs 35 · assets 66 · asset maintenance 17 · vehicles 3 · vehicle logs 6 · suppliers 5 · purchases 5 | 137 |
| Employees 14 · payroll 49 · deductions 3 · medicals 10 · certificates 6 · PPE issues 1 · appointments 2 · toolbox talks 1 | 86 |
| Expenses 56 · financial periods 9 · owner funding 8 · bank accounts 1 | 74 |
| KPI definitions 23 · KPI entries 75 · goals 61 · meetings 1 | 160 |
| Compliance documents 15 · forms 20 · docs 59 | 94 |
| Drives 8 · folders 42 · files 239 (the document vault index) | 289 |
| Staff logins 4 · settings 1 | 5 |
| **Data issues 523** (see below) | 523 |

## How it was checked

- **Validation**: every record is checked against the same rules the app uses (required fields, dates, SA ID and phone formats, money, enumerations). Result: **0 errors**. There are 87 warnings, all of them things to follow up rather than errors: 79 open leads have no follow-up date, 3 issued quotes have no issue date, and 5 phone numbers or emails are not in a valid format.
- **References**: every link between records (a visit to its site, an invoice to its client, a file to its folder) was resolved. Result: **0 broken links**.
- **Loading**: `npm run test:sql` loads `06_seed.sql` into real Postgres and confirms the count for every record type matches the pack exactly.
- **Money**: amounts are stored in rand and calculated in exact cents. Each invoice line is checked (quantity × price = amount). Where the printed total differs from the printed lines, the **printed total is kept** and the difference is noted on the invoice, so the records match what the client received.

## Data issues: what the source files disagree on

Where the company's own files contradict each other, have gaps or contain obvious slips (for example two different branch codes on two bank letters, a total that does not match its lines, or a name spelt two ways), the import **keeps what the source says** and records a **data issue** with the evidence and where to look. Nothing was guessed or quietly corrected.

| Source | High | Medium | Low |
|---|---|---|---|
| Sales workbook | 9 | 20 | 27 |
| CRM workbooks | 7 | 12 | 35 |
| KPI trackers | 6 | 8 | 27 |
| Schedule & operations registers | 6 | 17 | 43 |
| Income statements | 4 | 8 | 33 |
| Company documents | 3 | 8 | 21 |
| Invoices (April–July) | 3 | 18 | 28 |
| People & HR | 2 | 7 | 23 |
| Projects, fleet & purchases | 2 | 10 | 27 |
| Training records | 1 | 5 | 17 |
| Medicals | 0 | 15 | 11 |
| Health & safety forms, policies, SOPs | 0 | 22 | 22 |
| Strategy, marketing | 0 | 7 | 9 |
| **Total** | **43** | **157** | **323** |

Work through them in **Admin → Data health**, starting with the high ones. Record the answer on each issue once you have checked it against the original.

## What was deliberately left out

- **Clinical medical details**: only fitness outcomes and expiry dates are stored. The clinical text stays in the original documents, which are confidential in the HR drive.
- **Old CRM password hashes**: they are not in `06_seed.sql`. Supabase logins are created fresh (see [SETUP-SUPABASE.md](SETUP-SUPABASE.md#5-staff-logins)). Local mode keeps salted hashes so the four staff can sign in and must then change their password.

## Rebuilding the pack

With the extracted knowledge files:

```bash
node tools/build-seed.mjs --knowledge <folder with the knowledge json files>
```

The output goes to `data/seed/` along with `validation-report.json`. Add `--strict` to stop on any error.

A rebuilt pack loaded into local mode only refreshes records nobody has edited since the last import; anything a person changed is kept. In Supabase, re-running `06_seed.sql` behaves the same way.

## The document vault

`landscapers-inc-PRIVATE-vault.zip` contains the original files, laid out as `<shared drive>/<folder>/<file>`, with a `manifest.json` linking each one to its file record. It is built by `tools/build_vault.py` from the company zip. Import it in the app under **Drive → Import document vault**.
