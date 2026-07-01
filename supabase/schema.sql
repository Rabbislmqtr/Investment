-- Home Investment schema for Supabase.
-- Run this in the Supabase SQL editor for the Home Investment project.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.investment_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  target_amount_bdt numeric(14, 2) not null default 0 check (target_amount_bdt >= 0),
  currency_code text not null default 'BDT',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  resident_country text,
  role text not null default 'member' check (role in ('member', 'admin', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.investment_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_code text,
  joined_at date not null default current_date,
  status text not null default 'active' check (status in ('active', 'paused', 'left')),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.investment_projects(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  payment_date date not null,
  bdt_amount numeric(14, 2) not null check (bdt_amount > 0),
  source_currency text,
  source_amount numeric(14, 2) check (source_amount is null or source_amount > 0),
  exchange_rate numeric(14, 6) check (exchange_rate is null or exchange_rate > 0),
  sent_from_country text,
  payment_method text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.contributions(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  storage_bucket text not null default 'payment-receipts',
  storage_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint check (file_size is null or file_size > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  currency_code text not null,
  rate_to_bdt numeric(14, 6) not null check (rate_to_bdt > 0),
  effective_date date not null,
  created_at timestamptz not null default now(),
  unique (currency_code, effective_date)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  project_id uuid references public.investment_projects(id) on delete set null,
  contribution_id uuid references public.contributions(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists investment_projects_name_key
on public.investment_projects(name);

insert into public.investment_projects (name, description, currency_code)
values ('Land & Home Investment', 'Single active investment fund for future land and home purchase.', 'BDT')
on conflict (name) do update
set description = excluded.description,
    currency_code = excluded.currency_code,
    is_active = true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts',
  'payment-receipts',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.current_user_role()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
$$;

revoke all on function private.current_user_role() from public;
grant execute on function private.current_user_role() to authenticated;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_contributions_updated_at on public.contributions;
create trigger set_contributions_updated_at
before update on public.contributions
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists group_members_user_project_idx on public.group_members(user_id, project_id);
create index if not exists contributions_member_status_idx on public.contributions(member_id, status);
create index if not exists contributions_project_status_idx on public.contributions(project_id, status);
create index if not exists payment_receipts_contribution_idx on public.payment_receipts(contribution_id);

alter table public.investment_projects enable row level security;
alter table public.profiles enable row level security;
alter table public.group_members enable row level security;
alter table public.contributions enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.audit_logs enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.investment_projects to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.group_members to authenticated;
grant select, insert, update on public.contributions to authenticated;
grant select, insert on public.payment_receipts to authenticated;
grant select on public.exchange_rates to authenticated;
grant select, insert on public.audit_logs to authenticated;

drop policy if exists "authenticated can read active projects" on public.investment_projects;
create policy "authenticated can read active projects"
on public.investment_projects for select
to authenticated
using (is_active = true);

drop policy if exists "admins can manage projects" on public.investment_projects;
create policy "admins can manage projects"
on public.investment_projects for all
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "admins can read all profiles" on public.profiles;
create policy "admins can read all profiles"
on public.profiles for select
to authenticated
using ((select private.current_user_role()) = 'admin');

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id and role = (select private.current_user_role()));

drop policy if exists "admins can update profiles" on public.profiles;
create policy "admins can update profiles"
on public.profiles for update
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id and role = 'member');

drop policy if exists "members can read own membership" on public.group_members;
create policy "members can read own membership"
on public.group_members for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "admins can manage memberships" on public.group_members;
create policy "admins can manage memberships"
on public.group_members for all
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "members can read own contributions" on public.contributions;
create policy "members can read own contributions"
on public.contributions for select
to authenticated
using (member_id = (select auth.uid()));

drop policy if exists "members can create own pending contributions" on public.contributions;
create policy "members can create own pending contributions"
on public.contributions for insert
to authenticated
with check (member_id = (select auth.uid()) and status = 'pending');

drop policy if exists "admins can manage contributions" on public.contributions;
create policy "admins can manage contributions"
on public.contributions for all
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "members can read own receipts" on public.payment_receipts;
create policy "members can read own receipts"
on public.payment_receipts for select
to authenticated
using (uploaded_by = (select auth.uid()));

drop policy if exists "members can insert own receipts" on public.payment_receipts;
create policy "members can insert own receipts"
on public.payment_receipts for insert
to authenticated
with check (uploaded_by = (select auth.uid()));

drop policy if exists "admins can read receipts" on public.payment_receipts;
create policy "admins can read receipts"
on public.payment_receipts for select
to authenticated
using ((select private.current_user_role()) = 'admin');

drop policy if exists "authenticated can read exchange rates" on public.exchange_rates;
create policy "authenticated can read exchange rates"
on public.exchange_rates for select
to authenticated
using (true);

drop policy if exists "admins can write exchange rates" on public.exchange_rates;
create policy "admins can write exchange rates"
on public.exchange_rates for all
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "admins can read audit logs" on public.audit_logs;
create policy "admins can read audit logs"
on public.audit_logs for select
to authenticated
using ((select private.current_user_role()) = 'admin');

drop policy if exists "admins can insert audit logs" on public.audit_logs;
create policy "admins can insert audit logs"
on public.audit_logs for insert
to authenticated
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "members can upload receipt files" on storage.objects;
create policy "members can upload receipt files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "members can read own receipt files" on storage.objects;
create policy "members can read own receipt files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "admins can read all receipt files" on storage.objects;
create policy "admins can read all receipt files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-receipts'
  and (select private.current_user_role()) = 'admin'
);
