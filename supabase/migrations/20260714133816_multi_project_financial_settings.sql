alter table public.investment_projects
  add column if not exists status text,
  add column if not exists planned_member_count integer,
  add column if not exists monthly_contribution_bdt numeric(14, 2),
  add column if not exists contribution_start_month date;

update public.investment_projects
set status = case when is_active then 'active' else 'paused' end
where status is null;

update public.investment_projects
set planned_member_count = 10
where planned_member_count is null;

update public.investment_projects
set monthly_contribution_bdt = 10000
where monthly_contribution_bdt is null;

update public.investment_projects
set contribution_start_month = date '2026-01-01'
where contribution_start_month is null;

alter table public.investment_projects
  alter column status set default 'draft',
  alter column status set not null,
  alter column planned_member_count set default 10,
  alter column planned_member_count set not null,
  alter column monthly_contribution_bdt set default 10000,
  alter column monthly_contribution_bdt set not null,
  alter column contribution_start_month set default date_trunc('month', current_date)::date,
  alter column contribution_start_month set not null;

alter table public.investment_projects
  drop constraint if exists investment_projects_status_check,
  drop constraint if exists investment_projects_planned_member_count_check,
  drop constraint if exists investment_projects_monthly_contribution_bdt_check,
  drop constraint if exists investment_projects_contribution_start_month_check;

alter table public.investment_projects
  add constraint investment_projects_status_check
    check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  add constraint investment_projects_planned_member_count_check
    check (planned_member_count > 0),
  add constraint investment_projects_monthly_contribution_bdt_check
    check (monthly_contribution_bdt > 0),
  add constraint investment_projects_contribution_start_month_check
    check (contribution_start_month = date_trunc('month', contribution_start_month)::date);

create index if not exists investment_projects_status_idx
on public.investment_projects(status, created_at);

grant select, insert, update, delete on public.investment_projects to authenticated;

drop policy if exists "authenticated can read active projects" on public.investment_projects;
drop policy if exists "members can read assigned projects" on public.investment_projects;
create policy "members can read assigned projects"
on public.investment_projects for select
to authenticated
using (private.current_user_can_read_project(public.investment_projects.id));

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

revoke all on function private.current_user_can_submit_to_project(uuid) from public;
grant execute on function private.current_user_can_submit_to_project(uuid) to authenticated;
