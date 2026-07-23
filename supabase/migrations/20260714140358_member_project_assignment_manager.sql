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
