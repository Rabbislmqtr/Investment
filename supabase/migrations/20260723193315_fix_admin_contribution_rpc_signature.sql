drop function if exists public.create_admin_approved_contribution_with_receipt(
  uuid, uuid, uuid, date, numeric, text, numeric, numeric,
  text, text, text, text, text, text, text, bigint
);

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
    select 1
    from public.group_members
    where project_id = p_project_id
      and user_id = p_member_id
      and status <> 'left'
  ) then
    raise exception 'Selected member is not active in this project.';
  end if;

  if p_storage_bucket is distinct from 'payment-receipts'
     or split_part(coalesce(p_storage_path, ''), '/', 1) is distinct from p_member_id::text then
    raise exception 'Receipt path does not belong to the selected member.';
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = p_storage_bucket
      and name = p_storage_path
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

revoke all on function public.create_admin_approved_contribution_with_receipt(
  uuid, uuid, date, numeric, text, numeric, numeric,
  text, text, text, text, text, text, text, bigint
) from public, anon, authenticated, service_role;

grant execute on function public.create_admin_approved_contribution_with_receipt(
  uuid, uuid, date, numeric, text, numeric, numeric,
  text, text, text, text, text, text, text, bigint
) to authenticated;

drop policy if exists "admins can insert member receipts" on public.payment_receipts;
create policy "admins can insert member receipts"
on public.payment_receipts
for insert
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

notify pgrst, 'reload schema';
