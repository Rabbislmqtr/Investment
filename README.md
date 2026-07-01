# Home Investment

Single-investment member portal for tracking BDT contributions toward a future land and home purchase.

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase publishable key from the Supabase project connect dialog.
3. Run the schema in `supabase/schema.sql` against the `Home Investment` Supabase project.
4. Create your first account in the app.
5. Promote your first admin by editing and running `supabase/promote-admin.sql`.
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
- Single visible investment project, with database support for future projects.

## Environment

Use only the Supabase publishable key in `VITE_SUPABASE_PUBLISHABLE_KEY`. Do not put a Supabase secret or service-role key in `.env.local` or Netlify public environment variables.
