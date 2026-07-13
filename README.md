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

## Environment

Use only the Supabase publishable key in `VITE_SUPABASE_PUBLISHABLE_KEY`. Do not put a Supabase secret or service-role key in `.env.local` or Netlify public environment variables.

The Netlify Functions require these server-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Never prefix the service-role key with `VITE_`; that would expose it in the browser bundle.

For an existing database, run `supabase/migrations/20260713101555_security_and_reliability_hardening.sql` in the Supabase SQL editor. The migration preserves the rule that every member owes the same cumulative monthly amount from January 2026, regardless of join date.

Before deployment, add the production site URL to Supabase Auth redirect URLs so password-reset links can return to the application.
