# Landscapers Inc. HQ: staff guide

One app for the whole company, on your phone and on the office PC. What you see depends on your role, so some apps below may not be on your screen.

## Getting around

- **Sign in**: tap your name and enter your password. The first time, you choose your own.
- **Apps**: the left menu on a PC; the bottom bar and the grid button on a phone. Star your favourites.
- **Search everything**: the search box at the top, or **Ctrl + K**. It finds clients, invoices, people, documents and settings.
- **New**: the green **+ New** button creates an invoice, quote, event, task, visit, lead, note, email, checklist and more from anywhere.
- **Sage AI**: the sparkle button, or the Sage app. Ask in plain English, for example "who owes us money", "what is on today" or "who added the 10 September meeting".
- **Bell**: your notifications and reminders.
- **Offline**: keep working with poor signal. Changes are sent when you are back online.
- **Install on your phone**: see [DEPLOY.md](DEPLOY.md#installing-on-phones-and-pcs).

Every record shows **who created it and when** and **who last changed it**. The system records this; nobody types it.

## Workspace

| App | What it is for |
|---|---|
| **Daily Briefing** | Your start-of-day page. Owners get the 05:30 executive briefing: what the agent did overnight, today's dispatch, approvals waiting, money in and out, alerts |
| **Autonomous Core** | The 24/7 agent (managers). Its runs, decisions, approvals queue, outbox, weather board and dispatch plan |
| **Sage AI** | Questions about the business, answered from live data. Tap the microphone to speak |
| **Mail** | Company and team email. Messages to clients go out from the company address |
| **Calendar** | Company and personal events, South African public holidays, company closures and reminders. Each event shows who added it |
| **Drive & Vault** | Shared drives (ADMIN, FINANCE, HR, LEGAL AND COMPLIANCE, MANAGEMENT, OPERATIONS, SALES, SOP'S & TEMPLATES), the original company documents and before/after photos |
| **Docs / Sheets / Slides** | Documents, spreadsheets with formulas (open and save Excel files), and presentations (a proposal deck straight from a quote) |
| **Forms** | Checklists, inspections, incident and HR forms, filled in on your phone |
| **Chat / Meet** | Team spaces, direct messages and video meetings |
| **Keep / Tasks / Contacts** | Quick notes, to-dos, and everyone the company deals with |

## Everyday tasks

### Plan and run the day (dispatch)

1. **Live Dispatch** shows today's board: every visit by crew, with the route map.
2. The agent plans routes at **05:00** and **postpones visits when the weather is bad**. Each change is logged in Autonomous Core with its reason.
3. Visits for maintenance contracts come from the contract's visit days (**Generate visits from contracts**). Visits that fall on a public holiday are moved automatically and listed under **Moved for public holidays**.
4. **Print run-sheets** gives each crew a paper copy.

### On site (phone)

1. Open the visit (Live Dispatch → your visit, or from the calendar).
2. **Check in** records the time and your GPS position.
3. Do the work, **Add photo** for before and after, add notes.
4. **Check out**. If the job is billable on the spot, create the invoice from the visit (next section).
5. Could not get in? Tap **No access** and say what happened. It shows on the dispatch board so the office can reschedule.

### Invoice a client (office or on site)

1. **+ New → Invoice**, or **Invoices → New invoice**.
2. Choose the client and site. Lines can come from the service catalogue (prices filled in) or be typed.
3. **Issue** it, then send it by email or **WhatsApp with PDF**.
4. The status updates itself as money comes in: *Unpaid → Partially paid → Paid*, or *Overdue*, and *Awaiting POP verification* when a proof of payment arrives.
5. Monthly contract billing: **Invoices → Billing run** creates every contract invoice for the month in one step (**Create drafts** or **Create & issue all**). It skips anything already billed.

Numbers, dates, VAT (only if the company is VAT registered) and totals are calculated exactly to the cent.

### Quote a job

1. **+ New → Quote**. Pick the client and services, then adjust quantities and rates. Margin shows as you go.
2. **Send**. The client's answer is recorded with **Client accepts** or **Client declined**.
3. Accepted? **Convert to invoice**, or raise a **Deposit invoice** first.
4. Need changes? **Revise (new version)** keeps the history.
5. Want a proposal? **Slides → Client proposal**, then pick the quote. It builds a branded deck.

### Money in (payments and debtors)

1. **Payments & Debtors → Record payment** against an invoice (part payments are fine).
2. A client sends a proof of payment? **Match a POP** finds the invoice by amount and reference.
3. The agent sends reminders at **3, 7 and 14 days overdue** (email, or WhatsApp waiting for one-tap approval), and matches proofs of payment that arrive by email.
4. **Statement PDF** gives a client their full account.
5. **Debtors & ageing** shows who owes what: 0–30, 31–60, 60+ days.

### Calendar and reminders

- **Create event**: set the time, attendees and reminders. By default you are reminded 30 minutes and 1 day before.
- **Create an event by asking**: type, for example, "site meeting at Mount Edgecombe Friday 10am".
- South African public holidays are built in. When a holiday falls on a Sunday, the Monday is off. Add company closures under **Holidays**.
- Every event shows who added it and when, for example *Added by Wayne*, and who last edited it.

### Forms and checklists

1. **Forms → Fill in** on your phone. If you lose signal, your answers are kept as a draft on your phone.
2. Inspection checklists use the company risk key (1 = compliant … 5 = critical). A **4 or 5 alerts management immediately**.
3. HR forms (grievance, warning, counselling) and incident forms are **confidential**: only you, management and HR (plus operations for incidents) can read them.
4. After an incident form, you can log it in **Health & Safety** in one step. Only the date, type, place, people and description are copied; medical details stay on the confidential form.

### Documents

- **Drive → shared drive → folder** is laid out like the company's Google Drive. The FINANCE and HR drives are restricted.
- Tick **Confidential** on sensitive files to limit them to management and HR.
- Expiry dates on documents (licences, certificates, compliance) appear in the calendar and alerts before they lapse.

## People, safety and compliance (managers and HR)

- **Employees**: staff records, contracts, ex-employees. ID numbers, pay and bank details show only to manager, HR and finance.
- **Training & Certificates** and **Medicals**: expiry dates with reminders. Medicals hold the fitness outcome and expiry only.
- **Health & Safety**: incidents, PPE issues, inspections, toolbox talks and legal appointments.
- **Compliance & Legal**: company registrations and renewals.

## Finance and insight (managers and finance)

- **Finance**: income statement, expenses, cash flow and budgets.
- **KPIs & Performance** and **Strategy & Goals**: the weekly KPI registers and the 12-month plan.
- **Reports & BI**: dashboards and exports.
- **Neural Learning Hub**: models that learn from the company's own history (payment risk, lead scoring, job duration, pricing). Each model is tested on records it did not learn from, is shown next to a simple baseline so you can see whether it really helps, and retrains as new records arrive.

## Admin console (owner and admin)

**Admin →**

- **Users**: invite, suspend, reset.
- **Roles**: what each role is offered.
- **Company**: name, VAT, banking, branding.
- **Audit log**: every change, by whom, when.
- **Data health**: records needing attention.
- **Backup**, **Import** (CSV and Excel) and **System**.

## Tips

- Most lists export to Excel or CSV and print cleanly.
- Deleted by mistake? Records go to the **trash** and can be restored.
- Something wrong? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
