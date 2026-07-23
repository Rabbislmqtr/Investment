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
      from public.group_members
      where project_id = target_project_id
        and user_id = (select auth.uid())
        and status = 'active'
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

grant select, insert, update on public.member_exit_requests to authenticated;
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
