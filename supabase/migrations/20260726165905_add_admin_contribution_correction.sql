create or replace function public.correct_approved_contribution_amount(
  p_contribution_id uuid,
  p_bdt_amount numeric,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.contributions%rowtype;
begin
  if (select private.current_user_role()) <> 'admin' then
    raise exception 'Only admins can correct approved contributions.';
  end if;

  if p_bdt_amount is null or p_bdt_amount <= 0 then
    raise exception 'Corrected BDT amount must be greater than zero.';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'A correction reason is required.';
  end if;

  select *
  into target
  from public.contributions
  where id = p_contribution_id
  for update;

  if not found then
    raise exception 'Contribution not found.';
  end if;

  if target.status <> 'approved' then
    raise exception 'Only approved contributions can be corrected.';
  end if;

  if exists (
    select 1
    from public.member_exit_requests exit_request
    where exit_request.project_id = target.project_id
      and exit_request.member_id = target.member_id
      and exit_request.status in ('settlement_approved', 'refund_pending', 'completed')
  ) then
    raise exception 'This contribution cannot be corrected after an exit settlement has been approved.';
  end if;

  if target.bdt_amount = p_bdt_amount then
    raise exception 'The corrected amount is unchanged.';
  end if;

  update public.contributions
  set bdt_amount = p_bdt_amount
  where id = target.id;

  insert into public.audit_logs (actor_id, project_id, contribution_id, action, details)
  values (
    (select auth.uid()),
    target.project_id,
    target.id,
    'approved_contribution_amount_corrected',
    jsonb_build_object(
      'memberId', target.member_id,
      'oldBdtAmount', target.bdt_amount,
      'newBdtAmount', p_bdt_amount,
      'reason', btrim(p_reason)
    )
  );
end;
$$;

revoke all on function public.correct_approved_contribution_amount(uuid, numeric, text) from public, anon;
grant execute on function public.correct_approved_contribution_amount(uuid, numeric, text) to authenticated;
