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
