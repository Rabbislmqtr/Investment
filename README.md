# Home Investment

Single-investment member portal for tracking BDT contributions toward a future land and home purchase.

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase publishable key from the Supabase project connect dialog.
3. Run the schema in `supabase/schema.sql` against the `Home Investment` Supabase project.
4. Create the first account from Supabase Authentication, then promote it by editing and running `supabase/promote-admin.sql`.
5. Disable public user signups in Supabase Auth settings. Additional members are created from the admin dashboard.
6. Install dependencies and start the app:

```bash
npm install
npm run dev
```

## First Version Scope

- Email/password login through Supabase Auth.
- Member dashboard for BDT totals and contribution history.
- Payment proof upload for PDF/JPG/PNG receipts.
- Admin review queue for approving and rejecting submitted contributions.
- Admin-created member accounts and password recovery.
- Single visible investment project, with database support for future projects.

## PDF report export

The admin **Reports** tab (`Approved ledger report`) prints a three-sheet statement of
account from the approved ledger:

1. **Member accounts** — every active member, paid or not, with required-to-date, paid-to-date,
   balance, paid-through month and coverage. Unpaid members sort first, largest shortfall at the top.
2. **Payment calendar** — a member × month grid showing what each member paid in each month,
   in six-month blocks with the member column repeated.
3. **Ledger detail** — every approved payment in date order with month subtotals and a running
   total, closing on a balance that reconciles to the fund position on sheet 1.

`Save as PDF` opens the browser print dialog on the statement. The document is rendered outside
the application root and carries its own light paper palette, so it prints as paper regardless of
the app's dark theme. Two things worth knowing:

- Choose **Save as PDF** as the destination, and leave **Headers and footers** unticked for a
  clean sheet. The suggested filename comes from the document title.
- The on-screen `Preview sheet` overlay renders at true A4 size. Scroll sideways for the full sheet.

Amounts are rounded to whole taka as they enter the report model, so every column foots exactly
to the rows above it. The fund position is always all-time across every member, while the ledger
detail respects the on-screen month and member filters; the note under the member table states
any difference, including money still held for members who have left the fund.

The statement is its own module under [`src/report/`](src/report): the document component, its
`statement.css`, the `tokens.css` it owns, and the font warm-up the print path needs. Its design
tokens are namespaced `--report-*` so they never collide with the application's own theme
tokens, and no application rule reads them.

## Environment

Use only the Supabase publishable key in `VITE_SUPABASE_PUBLISHABLE_KEY`. Do not put a Supabase secret or service-role key in `.env.local` or Netlify public environment variables.

The Netlify Functions require these server-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Never prefix the service-role key with `VITE_`; that would expose it in the browser bundle.

For an existing database, run `supabase/migrations/20260713101555_security_and_reliability_hardening.sql` in the Supabase SQL editor. The migration preserves the rule that every member owes the same cumulative monthly amount from January 2026, regardless of join date.

Before deployment, add the production site URL to Supabase Auth redirect URLs so password-reset links can return to the application.
