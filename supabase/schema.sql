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
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  planned_member_count integer not null default 10 check (planned_member_count > 0),
  monthly_contribution_bdt numeric(14, 2) not null default 10000 check (monthly_contribution_bdt > 0),
  contribution_start_month date not null default date_trunc('month', current_date)::date
    check (contribution_start_month = date_trunc('month', contribution_start_month)::date),
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
    is_active = true,
    status = 'active';

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

create or replace function private.current_user_can_read_project(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.group_members
    where project_id = target_project_id
      and user_id = (select auth.uid())
      and status <> 'left'
  )
$$;

create or replace function private.current_user_can_read_member(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.group_members viewer_membership
    join public.group_members target_membership
      on target_membership.project_id = viewer_membership.project_id
    where viewer_membership.user_id = (select auth.uid())
      and viewer_membership.status <> 'left'
      and target_membership.user_id = target_user_id
      and target_membership.status <> 'left'
  )
$$;

create or replace function private.current_user_can_read_approved_contribution(target_contribution_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.contributions
    where id = target_contribution_id
      and status = 'approved'
      and private.current_user_can_read_project(project_id)
  )
$$;

create or replace function private.current_user_can_read_receipt_file(target_bucket text, target_path text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.payment_receipts receipt
    join public.contributions approved_contribution
      on approved_contribution.id = receipt.contribution_id
    where receipt.storage_bucket = target_bucket
      and receipt.storage_path = target_path
      and approved_contribution.status = 'approved'
      and private.current_user_can_read_project(approved_contribution.project_id)
  )
$$;

create or replace function private.current_user_can_submit_to_project(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select private.current_user_role()) = 'member'
    and exists (
      select 1
      from public.group_members membership
      join public.investment_projects project on project.id = membership.project_id
      where membership.project_id = target_project_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and project.status = 'active'
    )
$$;

create or replace function private.get_project_member_directory(target_project_id uuid)
returns table(id uuid, full_name text)
language sql
security definer
set search_path = ''
stable
as $$
  select profile.id, profile.full_name
  from public.group_members membership
  join public.profiles profile on profile.id = membership.user_id
  where membership.project_id = target_project_id
    and membership.status <> 'left'
    and (
      (select private.current_user_role()) = 'admin'
      or private.current_user_can_read_project(target_project_id)
    )
$$;

create or replace function public.get_project_member_directory(target_project_id uuid)
returns table(id uuid, full_name text)
language sql
security invoker
set search_path = ''
stable
as $$
  select * from private.get_project_member_directory(target_project_id)
$$;

create or replace function public.create_pending_contribution_with_receipt(
  p_project_id uuid,
  p_payment_date date,
  p_bdt_amount numeric,
  p_source_currency text,
  p_source_amount numeric,
  p_exchange_rate numeric,
  p_sent_from_country text,
  p_payment_method text,
  p_notes text,
  p_storage_bucket text,
  p_storage_path text,
  p_file_name text,
  p_file_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  contribution_id uuid;
begin
  if p_storage_bucket <> 'payment-receipts'
     or split_part(p_storage_path, '/', 1) <> (select auth.uid())::text then
    raise exception 'Receipt path does not belong to the signed-in member.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = p_storage_bucket and name = p_storage_path
  ) then
    raise exception 'Uploaded receipt could not be verified.';
  end if;

  insert into public.contributions (
    project_id, member_id, payment_date, bdt_amount, source_currency,
    source_amount, exchange_rate, sent_from_country, payment_method, notes, status
  ) values (
    p_project_id, (select auth.uid()), p_payment_date, p_bdt_amount, nullif(p_source_currency, ''),
    p_source_amount, p_exchange_rate, nullif(p_sent_from_country, ''),
    nullif(p_payment_method, ''), nullif(p_notes, ''), 'pending'
  )
  returning id into contribution_id;

  insert into public.payment_receipts (
    contribution_id, uploaded_by, storage_bucket, storage_path,
    file_name, file_type, file_size
  ) values (
    contribution_id, (select auth.uid()), p_storage_bucket, p_storage_path,
    p_file_name, p_file_type, p_file_size
  );

  return contribution_id;
end;
$$;

create or replace function public.admin_update_member_record(
  p_project_id uuid,
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_resident_country text,
  p_role text,
  p_member_code text,
  p_joined_at date,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select private.current_user_role()) <> 'admin' then
    raise exception 'Only admins can update member records.';
  end if;

  update public.profiles
  set full_name = p_full_name,
      phone = nullif(p_phone, ''),
      resident_country = nullif(p_resident_country, ''),
      role = p_role
  where id = p_user_id;

  if not found then
    raise exception 'Member profile was not found.';
  end if;

  if p_role = 'admin' then
    delete from public.group_members
    where project_id = p_project_id and user_id = p_user_id;
  else
    insert into public.group_members (project_id, user_id, member_code, joined_at, status)
    values (p_project_id, p_user_id, nullif(p_member_code, ''), p_joined_at, p_status)
    on conflict (project_id, user_id) do update
    set member_code = excluded.member_code,
        joined_at = excluded.joined_at,
        status = excluded.status;
  end if;
end;
$$;

create or replace function public.review_contribution(
  p_contribution_id uuid,
  p_status text,
  p_rejection_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reviewed_project_id uuid;
begin
  if (select private.current_user_role()) <> 'admin' then
    raise exception 'Only admins can review contributions.';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid contribution review status.';
  end if;

  update public.contributions
  set status = p_status,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      rejection_reason = case when p_status = 'rejected' then coalesce(nullif(p_rejection_reason, ''), 'Not approved') else null end
  where id = p_contribution_id
  returning project_id into reviewed_project_id;

  if reviewed_project_id is null then
    raise exception 'Contribution was not found.';
  end if;

  insert into public.audit_logs (actor_id, project_id, contribution_id, action, details)
  values (
    (select auth.uid()), reviewed_project_id, p_contribution_id,
    'contribution_' || p_status,
    jsonb_build_object('rejectionReason', nullif(p_rejection_reason, ''))
  );
end;
$$;

create or replace function public.complete_admin_member_creation(
  p_actor_id uuid,
  p_project_id uuid,
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_resident_country text,
  p_member_code text,
  p_joined_at date,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, phone, resident_country, role)
  values (p_user_id, p_full_name, p_email, nullif(p_phone, ''), nullif(p_resident_country, ''), 'member')
  on conflict (id) do update
  set full_name = excluded.full_name,
      email = excluded.email,
      phone = excluded.phone,
      resident_country = excluded.resident_country,
      role = 'member';

  insert into public.group_members (project_id, user_id, member_code, joined_at, status)
  values (p_project_id, p_user_id, nullif(p_member_code, ''), p_joined_at, p_status)
  on conflict (project_id, user_id) do update
  set member_code = excluded.member_code,
      joined_at = excluded.joined_at,
      status = excluded.status;

  insert into public.audit_logs (actor_id, project_id, action, details)
  values (
    p_actor_id, p_project_id, 'admin_member_created',
    jsonb_build_object('memberId', p_user_id, 'email', p_email, 'memberCode', nullif(p_member_code, ''))
  );
end;
$$;

drop function if exists public.create_admin_approved_contribution_with_receipt(uuid, uuid, uuid, date, numeric, text, numeric, numeric, text, text, text, text, text, text, text, bigint);
create or replace function public.create_admin_approved_contribution_with_receipt(
  p_project_id uuid,
  p_member_id uuid,
  p_payment_date date,
  p_bdt_amount numeric,
  p_source_currency text,
  p_source_amount numeric,
  p_exchange_rate numeric,
  p_sent_from_country text,
  p_payment_method text,
  p_notes text,
  p_storage_bucket text,
  p_storage_path text,
  p_file_name text,
  p_file_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  contribution_id uuid;
begin
  if (select private.current_user_role()) <> 'admin' then
    raise exception 'Only admins can submit approved contributions.';
  end if;
  if not exists (
    select 1 from public.group_members
    where project_id = p_project_id and user_id = p_member_id and status <> 'left'
  ) then
    raise exception 'Selected member is not active in this project.';
  end if;

  if p_storage_bucket is distinct from 'payment-receipts'
     or split_part(coalesce(p_storage_path, ''), '/', 1) is distinct from p_member_id::text then
    raise exception 'Receipt path does not belong to the selected member.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = p_storage_bucket and name = p_storage_path
  ) then
    raise exception 'Uploaded receipt could not be verified.';
  end if;

  insert into public.contributions (
    project_id, member_id, payment_date, bdt_amount, source_currency,
    source_amount, exchange_rate, sent_from_country, payment_method, notes,
    status, reviewed_by, reviewed_at
  ) values (
    p_project_id, p_member_id, p_payment_date, p_bdt_amount, nullif(p_source_currency, ''),
    p_source_amount, p_exchange_rate, nullif(p_sent_from_country, ''),
    nullif(p_payment_method, ''), nullif(p_notes, ''), 'approved', (select auth.uid()), now()
  )
  returning id into contribution_id;

  insert into public.payment_receipts (
    contribution_id, uploaded_by, storage_bucket, storage_path,
    file_name, file_type, file_size
  ) values (
    contribution_id, p_member_id, p_storage_bucket, p_storage_path,
    p_file_name, p_file_type, p_file_size
  );

  insert into public.audit_logs (actor_id, project_id, contribution_id, action, details)
  values (
    (select auth.uid()), p_project_id, contribution_id, 'admin_member_payment_approved',
    jsonb_build_object('memberId', p_member_id, 'fileName', p_file_name)
  );

  return contribution_id;
end;
$$;

revoke all on function private.current_user_can_read_project(uuid) from public;
revoke all on function private.current_user_can_read_member(uuid) from public;
revoke all on function private.current_user_can_read_approved_contribution(uuid) from public;
revoke all on function private.current_user_can_read_receipt_file(text, text) from public;
revoke all on function private.current_user_can_submit_to_project(uuid) from public;
revoke all on function private.get_project_member_directory(uuid) from public;
grant execute on function private.current_user_can_read_project(uuid) to authenticated;
grant execute on function private.current_user_can_read_member(uuid) to authenticated;
grant execute on function private.current_user_can_read_approved_contribution(uuid) to authenticated;
grant execute on function private.current_user_can_read_receipt_file(text, text) to authenticated;
grant execute on function private.current_user_can_submit_to_project(uuid) to authenticated;
grant execute on function private.get_project_member_directory(uuid) to authenticated;

revoke all on function public.get_project_member_directory(uuid) from public;
revoke all on function public.create_pending_contribution_with_receipt(uuid, date, numeric, text, numeric, numeric, text, text, text, text, text, text, text, bigint) from public;
revoke all on function public.admin_update_member_record(uuid, uuid, text, text, text, text, text, date, text) from public;
revoke all on function public.review_contribution(uuid, text, text) from public;
revoke all on function public.complete_admin_member_creation(uuid, uuid, uuid, text, text, text, text, text, date, text) from public;
revoke all on function public.create_admin_approved_contribution_with_receipt(uuid, uuid, date, numeric, text, numeric, numeric, text, text, text, text, text, text, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.get_project_member_directory(uuid) to authenticated;
grant execute on function public.create_pending_contribution_with_receipt(uuid, date, numeric, text, numeric, numeric, text, text, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.admin_update_member_record(uuid, uuid, text, text, text, text, text, date, text) to authenticated;
grant execute on function public.review_contribution(uuid, text, text) to authenticated;
grant execute on function public.complete_admin_member_creation(uuid, uuid, uuid, text, text, text, text, text, date, text) to service_role;
grant execute on function public.create_admin_approved_contribution_with_receipt(uuid, uuid, date, numeric, text, numeric, numeric, text, text, text, text, text, text, text, bigint) to authenticated;

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
grant select, insert, update, delete on public.investment_projects to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.group_members to authenticated;
grant select, insert, update on public.contributions to authenticated;
grant select, insert on public.payment_receipts to authenticated;
grant select on public.exchange_rates to authenticated;
grant select, insert on public.audit_logs to authenticated;

drop policy if exists "authenticated can read active projects" on public.investment_projects;
drop policy if exists "members can read assigned projects" on public.investment_projects;
create policy "members can read assigned projects"
on public.investment_projects for select
to authenticated
using (private.current_user_can_read_project(public.investment_projects.id));

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

drop policy if exists "members can read project member profiles" on public.profiles;

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

drop policy if exists "members can read project memberships" on public.group_members;
create policy "members can read project memberships"
on public.group_members for select
to authenticated
using (private.current_user_can_read_project(public.group_members.project_id));

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

drop policy if exists "members can read approved project contributions" on public.contributions;
create policy "members can read approved project contributions"
on public.contributions for select
to authenticated
using (status = 'approved' and private.current_user_can_read_project(public.contributions.project_id));

drop policy if exists "members can create own pending contributions" on public.contributions;
create policy "members can create own pending contributions"
on public.contributions for insert
to authenticated
with check (
  member_id = (select auth.uid())
  and status = 'pending'
  and private.current_user_can_submit_to_project(public.contributions.project_id)
);

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

drop policy if exists "members can read approved project receipts" on public.payment_receipts;
create policy "members can read approved project receipts"
on public.payment_receipts for select
to authenticated
using (private.current_user_can_read_approved_contribution(public.payment_receipts.contribution_id));

drop policy if exists "members can insert own receipts" on public.payment_receipts;
create policy "members can insert own receipts"
on public.payment_receipts for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and storage_bucket = 'payment-receipts'
  and (storage.foldername(storage_path))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.contributions contribution
    where contribution.id = contribution_id
      and contribution.member_id = (select auth.uid())
  )
);

drop policy if exists "admins can read receipts" on public.payment_receipts;
create policy "admins can read receipts"
on public.payment_receipts for select
to authenticated
using ((select private.current_user_role()) = 'admin');

drop policy if exists "admins can insert member receipts" on public.payment_receipts;
create policy "admins can insert member receipts"
on public.payment_receipts for insert
to authenticated
with check (
  (select private.current_user_role()) = 'admin'
  and storage_bucket = 'payment-receipts'
  and (storage.foldername(storage_path))[1] = uploaded_by::text
  and exists (
    select 1
    from public.contributions contribution
    where contribution.id = contribution_id
      and contribution.member_id = uploaded_by
  )
);

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

drop policy if exists "admins can upload receipt files" on storage.objects;
create policy "admins can upload receipt files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'payment-receipts'
  and (select private.current_user_role()) = 'admin'
);

drop policy if exists "members can read own receipt files" on storage.objects;
create policy "members can read own receipt files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "members can delete own receipt files" on storage.objects;
create policy "members can delete own receipt files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "admins can delete receipt files" on storage.objects;
create policy "admins can delete receipt files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'payment-receipts'
  and (select private.current_user_role()) = 'admin'
);

drop policy if exists "members can read approved project receipt files" on storage.objects;
create policy "members can read approved project receipt files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-receipts'
  and private.current_user_can_read_receipt_file(storage.objects.bucket_id, storage.objects.name)
);

drop policy if exists "admins can read all receipt files" on storage.objects;
create policy "admins can read all receipt files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-receipts'
  and (select private.current_user_role()) = 'admin'
);

-- Member exit, settlement, and refund workflow.

create table if not exists public.member_exit_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.investment_projects(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  preferred_exit_date date,
  effective_exit_date date,
  reason text not null,
  status text not null default 'requested'
    check (status in ('requested', 'settlement_approved', 'refund_pending', 'completed', 'rejected', 'cancelled')),
  approved_contributions_bdt numeric(14, 2) not null default 0 check (approved_contributions_bdt >= 0),
  allocated_profit_bdt numeric(14, 2) not null default 0 check (allocated_profit_bdt >= 0),
  allocated_loss_bdt numeric(14, 2) not null default 0 check (allocated_loss_bdt >= 0),
  deductions_bdt numeric(14, 2) not null default 0 check (deductions_bdt >= 0),
  exit_fee_bdt numeric(14, 2) not null default 0 check (exit_fee_bdt >= 0),
  settlement_amount_bdt numeric(14, 2) not null default 0 check (settlement_amount_bdt >= 0),
  refund_due_date date,
  member_notes text,
  admin_notes text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_refunds (
  id uuid primary key default gen_random_uuid(),
  exit_request_id uuid not null references public.member_exit_requests(id) on delete restrict,
  project_id uuid not null references public.investment_projects(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  amount_bdt numeric(14, 2) not null check (amount_bdt > 0),
  payment_date date not null,
  payment_method text not null,
  payment_reference text,
  notes text,
  storage_bucket text not null default 'payment-receipts',
  storage_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint check (file_size is null or file_size > 0),
  paid_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.group_members
  add column if not exists left_at date,
  add column if not exists exit_request_id uuid references public.member_exit_requests(id) on delete set null;

create unique index if not exists member_exit_requests_one_open_idx
on public.member_exit_requests(project_id, member_id)
where status in ('requested', 'settlement_approved', 'refund_pending');

create index if not exists member_exit_requests_project_status_idx
on public.member_exit_requests(project_id, status, created_at desc);

create index if not exists member_exit_requests_member_idx
on public.member_exit_requests(member_id, created_at desc);

create index if not exists member_refunds_exit_request_idx
on public.member_refunds(exit_request_id, payment_date);

create index if not exists member_refunds_project_idx
on public.member_refunds(project_id, payment_date desc);

create index if not exists member_refunds_member_idx
on public.member_refunds(member_id, payment_date desc);

create index if not exists group_members_exit_request_idx
on public.group_members(exit_request_id)
where exit_request_id is not null;

create index if not exists member_exit_requests_reviewed_by_idx
on public.member_exit_requests(reviewed_by)
where reviewed_by is not null;

create index if not exists member_refunds_paid_by_idx
on public.member_refunds(paid_by);

drop trigger if exists set_member_exit_requests_updated_at on public.member_exit_requests;
create trigger set_member_exit_requests_updated_at
before update on public.member_exit_requests
for each row execute function public.set_updated_at();

create or replace function private.guard_member_exit_request_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.current_user_role()) = 'admin' then
    return new;
  end if;
  if (select auth.uid()) is null
     or old.member_id <> (select auth.uid())
     or old.status <> 'requested'
     or new.status <> 'cancelled'
     or new.id <> old.id
     or new.project_id <> old.project_id
     or new.member_id <> old.member_id
     or new.preferred_exit_date is distinct from old.preferred_exit_date
     or new.effective_exit_date is distinct from old.effective_exit_date
     or new.reason <> old.reason
     or new.approved_contributions_bdt <> old.approved_contributions_bdt
     or new.allocated_profit_bdt <> old.allocated_profit_bdt
     or new.allocated_loss_bdt <> old.allocated_loss_bdt
     or new.deductions_bdt <> old.deductions_bdt
     or new.exit_fee_bdt <> old.exit_fee_bdt
     or new.settlement_amount_bdt <> old.settlement_amount_bdt
     or new.refund_due_date is distinct from old.refund_due_date
     or new.member_notes is distinct from old.member_notes
     or new.admin_notes is distinct from old.admin_notes
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.completed_at is distinct from old.completed_at
     or new.created_at <> old.created_at then
    raise exception 'Members can only cancel an unchanged pending exit request.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_member_exit_request_update() from public, anon, authenticated;

drop trigger if exists guard_member_exit_request_update on public.member_exit_requests;
create trigger guard_member_exit_request_update
before update on public.member_exit_requests
for each row execute function private.guard_member_exit_request_update();

create or replace function private.guard_completed_member_exit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'left'
     and (tg_op = 'INSERT' or old.status is distinct from 'left')
     and not exists (
       select 1
       from public.member_exit_requests exit_request
       where exit_request.id = new.exit_request_id
         and exit_request.project_id = new.project_id
         and exit_request.member_id = new.user_id
         and exit_request.status = 'completed'
     ) then
    raise exception 'A member can only be marked left after the exit settlement is completed.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_completed_member_exit() from public, anon, authenticated;

drop trigger if exists guard_completed_member_exit on public.group_members;
create trigger guard_completed_member_exit
before insert or update on public.group_members
for each row execute function private.guard_completed_member_exit();

create or replace function private.current_user_can_read_project(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.group_members
    where project_id = target_project_id
      and user_id = (select auth.uid())
  )
$$;

create or replace function private.current_user_can_submit_to_project(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select private.current_user_role()) = 'member'
    and exists (
      select 1
      from public.group_members membership
      join public.investment_projects project on project.id = membership.project_id
      where membership.project_id = target_project_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and project.status = 'active'
    )
    and not exists (
      select 1
      from public.member_exit_requests
      where project_id = target_project_id
        and member_id = (select auth.uid())
        and status in ('settlement_approved', 'refund_pending', 'completed')
    )
$$;

create or replace function private.get_project_exit_summary(target_project_id uuid)
returns table(refunds_paid_bdt numeric, refunds_reserved_bdt numeric)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if (select private.current_user_role()) <> 'admin'
     and not (select private.current_user_can_read_project(target_project_id)) then
    raise exception 'You cannot read this project exit summary.';
  end if;

  return query
  select
    coalesce((
      select sum(refund.amount_bdt)
      from public.member_refunds refund
      where refund.project_id = target_project_id
    ), 0)::numeric,
    coalesce((
      select sum(greatest(
        exit_request.settlement_amount_bdt - coalesce((
          select sum(refund.amount_bdt)
          from public.member_refunds refund
          where refund.exit_request_id = exit_request.id
        ), 0),
        0
      ))
      from public.member_exit_requests exit_request
      where exit_request.project_id = target_project_id
        and exit_request.status in ('settlement_approved', 'refund_pending')
    ), 0)::numeric;
end;
$$;

create or replace function public.get_project_exit_summary(target_project_id uuid)
returns table(refunds_paid_bdt numeric, refunds_reserved_bdt numeric)
language sql
security invoker
set search_path = ''
stable
as $$
  select * from private.get_project_exit_summary(target_project_id)
$$;

create or replace function public.request_member_exit(
  p_project_id uuid,
  p_preferred_exit_date date,
  p_reason text,
  p_member_notes text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_request_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Please provide a clear reason of at least 10 characters.';
  end if;
  if p_preferred_exit_date is not null and p_preferred_exit_date < current_date then
    raise exception 'Preferred exit date cannot be in the past.';
  end if;
  if not exists (
    select 1
    from public.group_members membership
    where membership.project_id = p_project_id
      and membership.user_id = (select auth.uid())
      and membership.status <> 'left'
  ) then
    raise exception 'You do not have an active membership in this project.';
  end if;

  insert into public.member_exit_requests (
    project_id, member_id, preferred_exit_date, reason, member_notes
  ) values (
    p_project_id, (select auth.uid()), p_preferred_exit_date,
    trim(p_reason), nullif(trim(coalesce(p_member_notes, '')), '')
  )
  returning id into new_request_id;

  return new_request_id;
end;
$$;

create or replace function public.cancel_member_exit(p_exit_request_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.member_exit_requests
  set status = 'cancelled'
  where id = p_exit_request_id
    and member_id = (select auth.uid())
    and status = 'requested';

  if not found then
    raise exception 'Only a pending exit request can be cancelled.';
  end if;
end;
$$;

create or replace function public.review_member_exit(
  p_exit_request_id uuid,
  p_decision text,
  p_effective_exit_date date,
  p_refund_due_date date,
  p_allocated_profit_bdt numeric,
  p_allocated_loss_bdt numeric,
  p_deductions_bdt numeric,
  p_exit_fee_bdt numeric,
  p_admin_notes text
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  exit_request public.member_exit_requests%rowtype;
  approved_total numeric(14, 2);
  settlement_total numeric(14, 2);
begin
  if (select private.current_user_role()) <> 'admin' then
    raise exception 'Only admins can review member exits.';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Invalid exit review decision.';
  end if;

  select * into exit_request
  from public.member_exit_requests
  where id = p_exit_request_id
  for update;

  if exit_request.id is null or exit_request.status <> 'requested' then
    raise exception 'This exit request is no longer pending review.';
  end if;

  if p_decision = 'reject' then
    update public.member_exit_requests
    set status = 'rejected',
        admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
        reviewed_by = (select auth.uid()),
        reviewed_at = now()
    where id = exit_request.id;

    insert into public.audit_logs (actor_id, project_id, action, details)
    values (
      (select auth.uid()), exit_request.project_id, 'member_exit_rejected',
      jsonb_build_object('exitRequestId', exit_request.id, 'memberId', exit_request.member_id)
    );
    return 0;
  end if;

  if p_effective_exit_date is null or p_effective_exit_date < current_date then
    raise exception 'Effective exit date cannot be in the past.';
  end if;
  if p_refund_due_date is null or p_refund_due_date < p_effective_exit_date then
    raise exception 'Refund due date cannot be before the effective exit date.';
  end if;
  if least(
    coalesce(p_allocated_profit_bdt, 0), coalesce(p_allocated_loss_bdt, 0),
    coalesce(p_deductions_bdt, 0), coalesce(p_exit_fee_bdt, 0)
  ) < 0 then
    raise exception 'Settlement adjustments cannot be negative.';
  end if;
  if exists (
    select 1 from public.contributions
    where project_id = exit_request.project_id
      and member_id = exit_request.member_id
      and status = 'pending'
  ) then
    raise exception 'Resolve this member''s pending contributions before approving the exit.';
  end if;

  select coalesce(sum(bdt_amount), 0)::numeric(14, 2)
  into approved_total
  from public.contributions
  where project_id = exit_request.project_id
    and member_id = exit_request.member_id
    and status = 'approved';

  settlement_total := greatest(
    approved_total + coalesce(p_allocated_profit_bdt, 0)
      - coalesce(p_allocated_loss_bdt, 0)
      - coalesce(p_deductions_bdt, 0)
      - coalesce(p_exit_fee_bdt, 0),
    0
  );

  update public.member_exit_requests
  set status = case when settlement_total = 0 then 'completed' else 'settlement_approved' end,
      effective_exit_date = p_effective_exit_date,
      approved_contributions_bdt = approved_total,
      allocated_profit_bdt = coalesce(p_allocated_profit_bdt, 0),
      allocated_loss_bdt = coalesce(p_allocated_loss_bdt, 0),
      deductions_bdt = coalesce(p_deductions_bdt, 0),
      exit_fee_bdt = coalesce(p_exit_fee_bdt, 0),
      settlement_amount_bdt = settlement_total,
      refund_due_date = p_refund_due_date,
      admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      completed_at = case when settlement_total = 0 then now() else null end
  where id = exit_request.id;

  update public.group_members
  set status = case when settlement_total = 0 then 'left' else 'paused' end,
      left_at = case when settlement_total = 0 then p_effective_exit_date else null end,
      exit_request_id = exit_request.id
  where project_id = exit_request.project_id
    and user_id = exit_request.member_id;

  insert into public.audit_logs (actor_id, project_id, action, details)
  values (
    (select auth.uid()), exit_request.project_id, 'member_exit_settlement_approved',
    jsonb_build_object(
      'exitRequestId', exit_request.id,
      'memberId', exit_request.member_id,
      'approvedContributionsBdt', approved_total,
      'settlementAmountBdt', settlement_total
    )
  );

  return settlement_total;
end;
$$;

create or replace function public.record_member_refund(
  p_exit_request_id uuid,
  p_amount_bdt numeric,
  p_payment_date date,
  p_payment_method text,
  p_payment_reference text,
  p_notes text,
  p_storage_bucket text,
  p_storage_path text,
  p_file_name text,
  p_file_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  exit_request public.member_exit_requests%rowtype;
  already_paid numeric(14, 2);
  remaining_amount numeric(14, 2);
  new_paid_total numeric(14, 2);
  new_refund_id uuid;
begin
  if (select private.current_user_role()) <> 'admin' then
    raise exception 'Only admins can record member refunds.';
  end if;
  if p_amount_bdt is null or p_amount_bdt <= 0 then
    raise exception 'Refund amount must be greater than zero.';
  end if;
  if p_payment_date is null or p_payment_date > current_date then
    raise exception 'Refund payment date cannot be in the future.';
  end if;
  if length(trim(coalesce(p_payment_method, ''))) < 2 then
    raise exception 'Payment method is required.';
  end if;

  select * into exit_request
  from public.member_exit_requests
  where id = p_exit_request_id
  for update;

  if exit_request.id is null
     or exit_request.status not in ('settlement_approved', 'refund_pending') then
    raise exception 'This exit request is not awaiting a refund.';
  end if;

  select coalesce(sum(amount_bdt), 0)::numeric(14, 2)
  into already_paid
  from public.member_refunds
  where exit_request_id = exit_request.id;

  remaining_amount := exit_request.settlement_amount_bdt - already_paid;
  if p_amount_bdt > remaining_amount then
    raise exception 'Refund amount exceeds the remaining settlement balance.';
  end if;
  if p_storage_bucket <> 'payment-receipts'
     or split_part(p_storage_path, '/', 1) <> exit_request.member_id::text then
    raise exception 'Refund proof path does not belong to the departing member.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = p_storage_bucket and name = p_storage_path
  ) then
    raise exception 'Uploaded refund proof could not be verified.';
  end if;

  insert into public.member_refunds (
    exit_request_id, project_id, member_id, amount_bdt, payment_date,
    payment_method, payment_reference, notes, storage_bucket, storage_path,
    file_name, file_type, file_size, paid_by
  ) values (
    exit_request.id, exit_request.project_id, exit_request.member_id, p_amount_bdt,
    p_payment_date, trim(p_payment_method), nullif(trim(coalesce(p_payment_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), p_storage_bucket, p_storage_path,
    p_file_name, p_file_type, p_file_size, (select auth.uid())
  )
  returning id into new_refund_id;

  new_paid_total := already_paid + p_amount_bdt;

  update public.member_exit_requests
  set status = case when new_paid_total >= settlement_amount_bdt then 'completed' else 'refund_pending' end,
      completed_at = case when new_paid_total >= settlement_amount_bdt then now() else null end
  where id = exit_request.id;

  if new_paid_total >= exit_request.settlement_amount_bdt then
    update public.group_members
    set status = 'left',
        left_at = p_payment_date,
        exit_request_id = exit_request.id
    where project_id = exit_request.project_id
      and user_id = exit_request.member_id;
  end if;

  insert into public.audit_logs (actor_id, project_id, action, details)
  values (
    (select auth.uid()), exit_request.project_id, 'member_refund_recorded',
    jsonb_build_object(
      'exitRequestId', exit_request.id,
      'refundId', new_refund_id,
      'memberId', exit_request.member_id,
      'amountBdt', p_amount_bdt,
      'settlementCompleted', new_paid_total >= exit_request.settlement_amount_bdt
    )
  );

  return new_refund_id;
end;
$$;

alter table public.member_exit_requests enable row level security;
alter table public.member_refunds enable row level security;

grant select, update on public.member_exit_requests to authenticated;
grant insert (project_id, member_id, preferred_exit_date, reason, member_notes)
on public.member_exit_requests to authenticated;
grant select, insert on public.member_refunds to authenticated;

drop policy if exists "members can read own exit requests" on public.member_exit_requests;
create policy "members can read own exit requests"
on public.member_exit_requests for select
to authenticated
using (member_id = (select auth.uid()));

drop policy if exists "members can request their own exit" on public.member_exit_requests;
create policy "members can request their own exit"
on public.member_exit_requests for insert
to authenticated
with check (
  member_id = (select auth.uid())
  and status = 'requested'
  and approved_contributions_bdt = 0
  and allocated_profit_bdt = 0
  and allocated_loss_bdt = 0
  and deductions_bdt = 0
  and exit_fee_bdt = 0
  and settlement_amount_bdt = 0
  and effective_exit_date is null
  and refund_due_date is null
  and reviewed_by is null
  and reviewed_at is null
  and completed_at is null
  and exists (
    select 1
    from public.group_members membership
    where membership.project_id = member_exit_requests.project_id
      and membership.user_id = (select auth.uid())
      and membership.status <> 'left'
  )
);

drop policy if exists "members can cancel pending exit requests" on public.member_exit_requests;
create policy "members can cancel pending exit requests"
on public.member_exit_requests for update
to authenticated
using (member_id = (select auth.uid()) and status = 'requested')
with check (member_id = (select auth.uid()) and status = 'cancelled');

drop policy if exists "admins can manage exit requests" on public.member_exit_requests;
create policy "admins can manage exit requests"
on public.member_exit_requests for all
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "members can read own refunds" on public.member_refunds;
create policy "members can read own refunds"
on public.member_refunds for select
to authenticated
using (member_id = (select auth.uid()));

drop policy if exists "admins can manage refunds" on public.member_refunds;
create policy "admins can manage refunds"
on public.member_refunds for all
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

revoke all on function private.get_project_exit_summary(uuid) from public, anon;
grant execute on function private.get_project_exit_summary(uuid) to authenticated;

revoke all on function public.get_project_exit_summary(uuid) from public, anon;
revoke all on function public.request_member_exit(uuid, date, text, text) from public, anon;
revoke all on function public.cancel_member_exit(uuid) from public, anon;
revoke all on function public.review_member_exit(uuid, text, date, date, numeric, numeric, numeric, numeric, text) from public, anon;
revoke all on function public.record_member_refund(uuid, numeric, date, text, text, text, text, text, text, text, bigint) from public, anon;

grant execute on function public.get_project_exit_summary(uuid) to authenticated;
grant execute on function public.request_member_exit(uuid, date, text, text) to authenticated;
grant execute on function public.cancel_member_exit(uuid) to authenticated;
grant execute on function public.review_member_exit(uuid, text, date, date, numeric, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.record_member_refund(uuid, numeric, date, text, text, text, text, text, text, text, bigint) to authenticated;
create or replace function public.admin_set_project_membership(
  p_project_id uuid,
  p_user_id uuid,
  p_assigned boolean,
  p_status text default 'active'
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_status text;
  profile_role text;
begin
  if (select private.current_user_role()) <> 'admin' then
    raise exception 'Only admins can manage project assignments.';
  end if;

  if p_status not in ('active', 'paused') then
    raise exception 'Assignment status must be active or paused.';
  end if;

  if not exists (
    select 1 from public.investment_projects where id = p_project_id
  ) then
    raise exception 'Project was not found.';
  end if;

  select role into profile_role
  from public.profiles
  where id = p_user_id;

  if profile_role is null then
    raise exception 'Member profile was not found.';
  end if;
  if profile_role = 'admin' then
    raise exception 'Admin accounts cannot be assigned as project members.';
  end if;

  select status into existing_status
  from public.group_members
  where project_id = p_project_id
    and user_id = p_user_id;

  if p_assigned then
    if existing_status = 'left' then
      raise exception 'A completed project exit cannot be reactivated. Keep the historical membership record.';
    end if;

    insert into public.group_members (project_id, user_id, joined_at, status)
    values (p_project_id, p_user_id, current_date, p_status)
    on conflict (project_id, user_id) do update
    set status = excluded.status;

    insert into public.audit_logs (actor_id, project_id, action, details)
    values (
      (select auth.uid()),
      p_project_id,
      case when existing_status is null then 'project_member_assigned' else 'project_member_status_changed' end,
      jsonb_build_object('userId', p_user_id, 'status', p_status)
    );
  else
    if existing_status is null then
      return;
    end if;
    if existing_status = 'left' then
      raise exception 'Completed exit memberships must be retained for history.';
    end if;
    if exists (
      select 1
      from public.contributions
      where project_id = p_project_id
        and member_id = p_user_id
    ) or exists (
      select 1
      from public.member_exit_requests
      where project_id = p_project_id
        and member_id = p_user_id
    ) then
      raise exception 'This assignment has financial or exit history and cannot be removed. Pause it instead.';
    end if;

    delete from public.group_members
    where project_id = p_project_id
      and user_id = p_user_id;

    insert into public.audit_logs (actor_id, project_id, action, details)
    values (
      (select auth.uid()),
      p_project_id,
      'project_member_removed',
      jsonb_build_object('userId', p_user_id)
    );
  end if;
end;
$$;

revoke all on function public.admin_set_project_membership(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_project_membership(uuid, uuid, boolean, text) to authenticated;
