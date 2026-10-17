create table tameion_private.authorization_history (
  namespace text not null references tameion_private.demo_state(namespace),
  approval_id text not null,
  assessment_hash text not null check (assessment_hash ~ '^[0-9a-f]{64}$'),
  approval_record_hash text not null check (approval_record_hash ~ '^[0-9a-f]{64}$'),
  assurance_hash text not null check (assurance_hash ~ '^[0-9a-f]{64}$'),
  authorization_record jsonb not null check (jsonb_typeof(authorization_record) = 'object'),
  recorded_at timestamptz not null default pg_catalog.now(),
  primary key (namespace, approval_id)
);
alter table tameion_private.authorization_history enable row level security;
revoke all on tameion_private.authorization_history from public, anon, authenticated, service_role;

create or replace function public.tameion_state_load_or_seed(
  p_namespace text,
  p_initial_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, tameion_private
as $$
declare
  v_snapshot jsonb;
  v_revision bigint;
  v_assessment jsonb;
  v_authorization jsonb;
begin
  if p_namespace is null or length(p_namespace) not between 1 and 96
     or jsonb_typeof(p_initial_snapshot) is distinct from 'object'
     or jsonb_typeof(p_initial_snapshot #> '{authority,assessments}') is distinct from 'array'
     or jsonb_typeof(p_initial_snapshot->'authorization_history') is distinct from 'array' then
    raise exception 'invalid durable demo-state seed';
  end if;
  insert into tameion_private.demo_state(namespace, revision, snapshot)
  values (p_namespace, 1, p_initial_snapshot)
  on conflict (namespace) do nothing;
  select revision, snapshot into strict v_revision, v_snapshot
  from tameion_private.demo_state where namespace = p_namespace;
  for v_assessment in select value from jsonb_array_elements(v_snapshot #> '{authority,assessments}') loop
    insert into tameion_private.assessment_history(
      namespace, organization_id, obligation_id, assessment_id, assessment_hash, assessment_record
    ) values (
      p_namespace, v_assessment->>'organization_id', v_assessment->>'obligation_id',
      v_assessment #>> '{record,assessment_id}', v_assessment->>'hash', v_assessment->'record'
    ) on conflict do nothing;
  end loop;
  for v_authorization in select value from jsonb_array_elements(v_snapshot->'authorization_history') loop
    insert into tameion_private.authorization_history(
      namespace, approval_id, assessment_hash, approval_record_hash, assurance_hash, authorization_record
    ) values (
      p_namespace, v_authorization #>> '{approval_record,approval_id}',
      v_authorization #>> '{approval_record,assessment_hash}', v_authorization->>'approval_record_hash',
      v_authorization->>'assurance_hash', v_authorization
    ) on conflict do nothing;
  end loop;
  return jsonb_build_object('revision', v_revision, 'snapshot', v_snapshot);
end;
$$;

create or replace function public.tameion_state_compare_and_set(
  p_namespace text,
  p_expected_revision bigint,
  p_next_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, tameion_private
as $$
declare
  v_current tameion_private.demo_state%rowtype;
  v_old_assessments jsonb;
  v_new_assessments jsonb;
  v_old_authorizations jsonb;
  v_new_authorizations jsonb;
  v_prefix jsonb;
  v_count integer;
  v_authorization_count integer;
  v_entry jsonb;
  v_old_execution jsonb;
  v_new_execution jsonb;
  v_old_entry jsonb;
  v_matching_entry jsonb;
begin
  if p_namespace is null or p_expected_revision is null or p_expected_revision < 1
     or jsonb_typeof(p_next_snapshot) is distinct from 'object'
     or jsonb_typeof(p_next_snapshot #> '{authority,assessments}') is distinct from 'array'
     or jsonb_typeof(p_next_snapshot->'authorization_history') is distinct from 'array'
     or jsonb_typeof(p_next_snapshot->'execution_ledger') is distinct from 'array' then
    raise exception 'invalid durable demo-state update';
  end if;
  select * into v_current from tameion_private.demo_state
  where namespace = p_namespace for update;
  if not found or v_current.revision <> p_expected_revision then
    return jsonb_build_object('accepted', false, 'revision', coalesce(v_current.revision, 0));
  end if;

  v_old_assessments := v_current.snapshot #> '{authority,assessments}';
  v_new_assessments := p_next_snapshot #> '{authority,assessments}';
  v_count := jsonb_array_length(v_old_assessments);
  if jsonb_array_length(v_new_assessments) < v_count then
    return jsonb_build_object('accepted', false, 'revision', v_current.revision);
  end if;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into v_prefix
  from jsonb_array_elements(v_new_assessments) with ordinality as entries(value, ordinal)
  where ordinal <= v_count;
  if v_prefix <> v_old_assessments then
    return jsonb_build_object('accepted', false, 'revision', v_current.revision);
  end if;

  v_old_authorizations := v_current.snapshot->'authorization_history';
  v_new_authorizations := p_next_snapshot->'authorization_history';
  v_authorization_count := jsonb_array_length(v_old_authorizations);
  if jsonb_array_length(v_new_authorizations) < v_authorization_count then
    return jsonb_build_object('accepted', false, 'revision', v_current.revision);
  end if;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into v_prefix
  from jsonb_array_elements(v_new_authorizations) with ordinality as entries(value, ordinal)
  where ordinal <= v_authorization_count;
  if v_prefix <> v_old_authorizations then
    return jsonb_build_object('accepted', false, 'revision', v_current.revision);
  end if;

  v_old_execution := v_current.snapshot->'execution_ledger';
  v_new_execution := p_next_snapshot->'execution_ledger';
  for v_old_entry in select value from jsonb_array_elements(v_old_execution) loop
    select value into v_matching_entry from jsonb_array_elements(v_new_execution) as entries(value)
    where value->>'idempotency_key' = v_old_entry->>'idempotency_key';
    if v_matching_entry is null
       or v_matching_entry->>'obligation_id' is distinct from v_old_entry->>'obligation_id'
       or v_matching_entry->>'atomic_amount' is distinct from v_old_entry->>'atomic_amount'
       or v_matching_entry->>'destination_address' is distinct from v_old_entry->>'destination_address'
       or (v_old_entry->>'provider_ref' is not null and v_matching_entry->>'provider_ref' is distinct from v_old_entry->>'provider_ref')
       or (v_old_entry->>'status' in ('SETTLED', 'FAILED', 'BLOCKED') and v_matching_entry->>'status' is distinct from v_old_entry->>'status')
       or (v_old_entry->>'status' = 'UNKNOWN' and v_matching_entry->>'status' not in ('UNKNOWN', 'SETTLED', 'FAILED', 'BLOCKED')) then
      return jsonb_build_object('accepted', false, 'revision', v_current.revision);
    end if;
  end loop;

  for v_entry in
    select value from jsonb_array_elements(v_new_assessments) with ordinality as entries(value, ordinal)
    where ordinal > v_count
  loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or jsonb_typeof(v_entry->'record') is distinct from 'object'
       or coalesce(v_entry->>'organization_id', '') = ''
       or coalesce(v_entry->>'obligation_id', '') = ''
       or coalesce(v_entry #>> '{record,assessment_id}', '') = ''
       or coalesce(v_entry->>'hash', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid append-only assessment entry';
    end if;
    insert into tameion_private.assessment_history(
      namespace, organization_id, obligation_id, assessment_id, assessment_hash, assessment_record
    ) values (
      p_namespace, v_entry->>'organization_id', v_entry->>'obligation_id',
      v_entry #>> '{record,assessment_id}', v_entry->>'hash', v_entry->'record'
    );
  end loop;

  for v_entry in
    select value from jsonb_array_elements(v_new_authorizations) with ordinality as entries(value, ordinal)
    where ordinal > v_authorization_count
  loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or coalesce(v_entry #>> '{approval_record,approval_id}', '') = ''
       or coalesce(v_entry #>> '{approval_record,assessment_hash}', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_entry->>'approval_record_hash', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_entry->>'assurance_hash', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid append-only authorization entry';
    end if;
    insert into tameion_private.authorization_history(
      namespace, approval_id, assessment_hash, approval_record_hash, assurance_hash, authorization_record
    ) values (
      p_namespace, v_entry #>> '{approval_record,approval_id}',
      v_entry #>> '{approval_record,assessment_hash}', v_entry->>'approval_record_hash',
      v_entry->>'assurance_hash', v_entry
    );
  end loop;

  update tameion_private.demo_state
  set revision = revision + 1, snapshot = p_next_snapshot, updated_at = pg_catalog.now()
  where namespace = p_namespace;
  return jsonb_build_object('accepted', true, 'revision', v_current.revision + 1);
end;
$$;

revoke all on function public.tameion_state_load_or_seed(text, jsonb) from public, anon, authenticated;
revoke all on function public.tameion_state_compare_and_set(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.tameion_state_load_or_seed(text, jsonb) to service_role;
grant execute on function public.tameion_state_compare_and_set(text, bigint, jsonb) to service_role;
