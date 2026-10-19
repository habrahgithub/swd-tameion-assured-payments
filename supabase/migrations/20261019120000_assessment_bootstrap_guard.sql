-- Additive guard only; no data rewrite, tables, grants expansion or live application.
-- ROLLOUT: apply to the target database BEFORE the application release that offers
-- current-source assessment bootstrap, then set TAMEION_ASSESSMENT_BOOTSTRAP_GUARD=APPLIED
-- for that release. Without this migration the bootstrap capability stays disabled.
--
-- assessment_operations is not append-only history, so an old writer could drop or alter a
-- bootstrap operation. This guard rejects any compare-and-set that removes a bootstrap
-- operation or changes its identity, binding, preserved unverified reference or lineage,
-- or regresses its status. Intended progression (RESERVED -> PROVIDER_RESULT_DURABLE /
-- UNKNOWN / STALE / COMPLETED, PROVIDER_RESULT_DURABLE -> COMPLETED / STALE) is permitted.
-- Operations without a bootstrap marker are not inspected.
create or replace function tameion_private.assessment_bootstrap_guard(
  p_old jsonb,
  p_new jsonb
) returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_old jsonb := coalesce(p_old->'assessment_operations', '[]'::jsonb);
  v_new jsonb := coalesce(p_new->'assessment_operations', '[]'::jsonb);
  v_sealed jsonb := coalesce(p_new #> '{authority,assessments}', '[]'::jsonb);
  v_op jsonb;
  v_now jsonb;
  v_prior jsonb;
  v_matches integer;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(v_old) is distinct from 'array' then v_old := '[]'::jsonb; end if;
  if jsonb_typeof(v_sealed) is distinct from 'array' then v_sealed := '[]'::jsonb; end if;
  if jsonb_typeof(v_new) is distinct from 'array' then
    return not exists (select 1 from jsonb_array_elements(v_old) e where jsonb_typeof(e) = 'object' and e ? 'bootstrap');
  end if;

  for v_op in
    select e from jsonb_array_elements(v_old) e where jsonb_typeof(e) = 'object' and e ? 'bootstrap'
  loop
    select count(*) into v_matches from jsonb_array_elements(v_new) e
      where jsonb_typeof(e) = 'object' and e->>'idempotency_key' = v_op->>'idempotency_key';
    if v_matches <> 1 then return false; end if;
    select e into v_now from jsonb_array_elements(v_new) e
      where jsonb_typeof(e) = 'object' and e->>'idempotency_key' = v_op->>'idempotency_key';
    if v_now->'obligation_id' is distinct from v_op->'obligation_id'
       or v_now->'aggregate_version' is distinct from v_op->'aggregate_version'
       or v_now->'reserved_at' is distinct from v_op->'reserved_at'
       or v_now->'bootstrap' is distinct from v_op->'bootstrap'
       or jsonb_typeof(v_op->'recovery') is distinct from 'object'
       or jsonb_typeof(v_now->'recovery') is distinct from 'object'
       or (v_now->'recovery') - 'unknown_at' is distinct from (v_op->'recovery') - 'unknown_at'
       or ((v_op->'recovery') ? 'unknown_at' and (v_now->'recovery'->'unknown_at') is distinct from (v_op->'recovery'->'unknown_at'))
       or (v_now->>'status' = 'UNKNOWN' and not ((v_now->'recovery') ? 'unknown_at'))
       or (v_op->'assessment_hash' is not null and v_now->'assessment_hash' is distinct from v_op->'assessment_hash')
       or not coalesce(case v_op->>'status'
            when 'RESERVED' then v_now->>'status' in ('RESERVED', 'PROVIDER_RESULT_DURABLE', 'UNKNOWN', 'STALE', 'COMPLETED')
            when 'PROVIDER_RESULT_DURABLE' then v_now->>'status' in ('PROVIDER_RESULT_DURABLE', 'COMPLETED', 'STALE')
            when 'UNKNOWN' then v_now->>'status' = 'UNKNOWN'
            when 'COMPLETED' then v_now->>'status' = 'COMPLETED'
            when 'STALE' then v_now->>'status' = 'STALE'
            else false end, false) then
      return false;
    end if;
  end loop;

  for v_now in
    select e from jsonb_array_elements(v_new) e where jsonb_typeof(e) = 'object' and e ? 'bootstrap'
  loop
    v_prior := null;
    select e into v_prior from jsonb_array_elements(v_old) e
      where jsonb_typeof(e) = 'object' and e->>'idempotency_key' = v_now->>'idempotency_key' limit 1;
    if v_prior is not null and not (v_prior ? 'bootstrap') then return false; end if;
    if v_prior is null and (v_now->>'status' is distinct from 'RESERVED'
       or v_now->'recovery'->'generation' is distinct from '0'::jsonb) then
      return false;
    end if;
    if jsonb_typeof(v_now->'bootstrap') is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_now->'bootstrap')) <> 6
       or v_now->'bootstrap'->>'kind' is distinct from 'CURRENT_SOURCE_BOOTSTRAP'
       or v_now->'bootstrap'->>'unmatched_reference_status' is distinct from 'UNVERIFIED_ABSENT_FROM_RECORDED_OPERATIONS'
       or coalesce(v_now->'bootstrap'->>'source_record_sha256', '') !~ '^[a-f0-9]{64}$'
       or coalesce(v_now->'bootstrap'->>'binding_sha256', '') !~ '^[a-f0-9]{64}$'
       or coalesce(v_now->'bootstrap'->>'unmatched_reference_key', '') !~ v_uuid
       or v_now->'bootstrap'->'aggregate_version' is distinct from v_now->'aggregate_version'
       or v_now->'bootstrap'->>'source_record_sha256' is distinct from v_now->'recovery'->>'source_record_sha256'
       or v_now->'bootstrap'->>'binding_sha256' is distinct from v_now->'recovery'->>'binding_sha256'
       or v_now->'bootstrap'->>'unmatched_reference_key' = v_now->>'idempotency_key'
       or exists (select 1 from jsonb_array_elements(v_new) e
            where jsonb_typeof(e) = 'object' and e->>'idempotency_key' = v_now->'bootstrap'->>'unmatched_reference_key')
       or exists (select 1 from jsonb_array_elements(v_sealed) a
            where a #>> '{record,assessment_id}' = 'ASM-' || (v_now->'bootstrap'->>'unmatched_reference_key'))
       or (select count(*) from jsonb_array_elements(v_new) e
            where jsonb_typeof(e) = 'object' and e ? 'bootstrap' and e->>'obligation_id' = v_now->>'obligation_id') <> 1 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function tameion_private.assessment_bootstrap_guard(jsonb, jsonb) from public, anon, authenticated;

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
  v_old_links jsonb;
  v_new_links jsonb;
  v_link_count integer;
  v_field text;
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

  -- Bootstrap assessment operations are not append-only history; keep their identity immutable.
  if not tameion_private.assessment_bootstrap_guard(v_current.snapshot, p_next_snapshot) then
    raise exception 'assessment bootstrap operation immutability violated';
  end if;

  -- Once linked history exists, overlapping old writers cannot erase it.
  v_old_links := coalesce(v_current.snapshot->'linked_settlement_instructions','[]'::jsonb);
  v_new_links := coalesce(p_next_snapshot->'linked_settlement_instructions','[]'::jsonb);
  if jsonb_typeof(v_old_links) is distinct from 'array' or jsonb_typeof(v_new_links) is distinct from 'array'
     or jsonb_array_length(v_new_links)>1000 then raise exception 'invalid linked instruction history'; end if;
  if (p_next_snapshot ? 'linked_settlement_instructions') and p_next_snapshot->>'schema_version' is distinct from '2' then
    raise exception 'unsupported linked snapshot version';
  end if;
  v_link_count := jsonb_array_length(v_old_links);
  if jsonb_array_length(v_new_links)<v_link_count then return jsonb_build_object('accepted',false,'revision',v_current.revision); end if;
  select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into v_prefix
    from jsonb_array_elements(v_new_links) with ordinality as entries(value,ordinal) where ordinal<=v_link_count;
  if v_prefix is distinct from v_old_links then return jsonb_build_object('accepted',false,'revision',v_current.revision); end if;
  if (select count(distinct value->>'instruction_id') from jsonb_array_elements(v_new_links))<>jsonb_array_length(v_new_links)
    or (select count(distinct value->>'attempt_id') from jsonb_array_elements(v_new_links))<>jsonb_array_length(v_new_links) then
    raise exception 'duplicate linked instruction identity';
  end if;
  for v_entry in select value from jsonb_array_elements(v_new_links) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or v_entry->>'schema_version' is distinct from '1'
      or v_entry->>'kind' is distinct from 'ARC_TESTNET_SETTLEMENT_INSTRUCTION'
      or v_entry->>'status' is distinct from 'DRAFT_AUTHORITY_REQUIRED'
      or v_entry->>'organization_id' is distinct from 'ORG-DEMO-001'
      or v_entry->>'network' is distinct from 'ARC_TESTNET'
      or v_entry->>'classification' is distinct from 'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT'
      or coalesce(v_entry->>'instruction_id','') !~ '^TESTNET-CONTROLLED-LINKED-[a-f0-9]{32}$'
      or coalesce(v_entry->>'attempt_id','') !~ '^[a-f0-9-]{36}$'
      or coalesce(v_entry->>'source_record_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_entry->>'assessment_hash','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_entry->>'instruction_content_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_entry->>'source_obligation_id','') = '' or coalesce(v_entry->>'assessment_id','') = ''
      or jsonb_typeof(v_entry->'source_aggregate_version') is distinct from 'number'
      or coalesce(v_entry->>'source_amount','') !~ '^[0-9]+[.][0-9]{2}$'
      or coalesce(v_entry->>'source_currency','') !~ '^[A-Z]{3}$'
      or coalesce(v_entry->>'created_at','') = '' then raise exception 'malformed linked instruction'; end if;
    for v_field in select jsonb_object_keys(v_entry) loop
      if v_field not in ('schema_version','kind','status','organization_id','source_obligation_id','source_record_sha256','source_aggregate_version','assessment_id','assessment_hash','instruction_id','attempt_id','source_amount','source_currency','network','classification','created_at','instruction_content_sha256') then raise exception 'unknown linked instruction field'; end if;
      if v_field not in ('schema_version','source_aggregate_version') and jsonb_typeof(v_entry->v_field) is distinct from 'string' then raise exception 'malformed linked instruction type'; end if;
    end loop;
    if (select count(*) from jsonb_object_keys(v_entry))<>17
      or v_entry->>'source_aggregate_version' !~ '^[1-9][0-9]*$'
      or jsonb_typeof(v_entry->'schema_version') is distinct from 'number'
      or v_entry->>'created_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'malformed linked instruction structure'; end if;
  end loop;

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

revoke all on function public.tameion_state_compare_and_set(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.tameion_state_compare_and_set(text, bigint, jsonb) to service_role;
