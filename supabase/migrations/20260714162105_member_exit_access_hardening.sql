-- Tighten member-created exit rows and cover the remaining exit-workflow foreign keys.

revoke insert on public.member_exit_requests from authenticated;
grant insert (project_id, member_id, preferred_exit_date, reason, member_notes)
on public.member_exit_requests to authenticated;

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

create index if not exists member_exit_requests_reviewed_by_idx
on public.member_exit_requests(reviewed_by)
where reviewed_by is not null;

create index if not exists member_refunds_paid_by_idx
on public.member_refunds(paid_by);
