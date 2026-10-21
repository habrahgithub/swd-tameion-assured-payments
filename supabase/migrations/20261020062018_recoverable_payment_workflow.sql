-- R1 local code milestone. Apply only through separately authorized release.
-- Additive tables/guards; legacy histories, bootstrap and disposition controls stay installed.
create table tameion_private.human_authorization_history (
 namespace text not null references tameion_private.demo_state(namespace),
 approval_id text not null,
 review_decision_hash text not null check (review_decision_hash ~ '^[a-f0-9]{64}$'),
 authorization_record jsonb not null,
 recorded_at timestamptz not null default pg_catalog.now(),
 primary key(namespace,approval_id)
);
alter table tameion_private.human_authorization_history enable row level security;
revoke all on tameion_private.human_authorization_history from public,anon,authenticated,service_role;

-- A payer wallet has one durable financial namespace. This is deliberately not
-- a timer lease: expiry cannot abandon a possibly submitted financial claim.
create table tameion_private.wallet_financial_namespace (
 wallet_id text primary key,
 namespace text not null references tameion_private.demo_state(namespace),
 admitted_at timestamptz not null default pg_catalog.now()
);
alter table tameion_private.wallet_financial_namespace enable row level security;
revoke all on tameion_private.wallet_financial_namespace from public,anon,authenticated,service_role;
-- Conflicting existing active exposures abort installation; an owner must
-- adjudicate those claims before release. No automatic takeover or deletion.
insert into tameion_private.wallet_financial_namespace(wallet_id,namespace)
 select distinct reservation->>'wallet_id',state.namespace
 from tameion_private.demo_state state,
 lateral jsonb_array_elements(coalesce(state.snapshot #> '{authority,wallet_reservations}','[]'::jsonb)) reservation
 where reservation->>'state' in ('RESERVED','EXPOSURE_UNKNOWN');

create or replace function tameion_private.recovery_workflow_guard(p_old jsonb,p_new jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare old_rows jsonb; new_rows jsonb; field text; prefix jsonb; prior jsonb; current_row jsonb;
begin
 if (p_old ? 'source_ingress_anchor') and p_old->'source_ingress_anchor' is distinct from p_new->'source_ingress_anchor' then return false; end if;
 foreach field in array array['source_revisions','recovery_events','late_assessment_results','readiness_observations','linked_activation_receipts','linked_retirement_checks'] loop
  old_rows:=coalesce(p_old->field,'[]'::jsonb);new_rows:=coalesce(p_new->field,'[]'::jsonb);
  if jsonb_typeof(old_rows) is distinct from 'array' or jsonb_typeof(new_rows) is distinct from 'array' or jsonb_array_length(new_rows)>1000 then return false; end if;
  select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into prefix from jsonb_array_elements(new_rows) with ordinality e(value,ordinal) where ordinal<=jsonb_array_length(old_rows);
  if prefix is distinct from old_rows then return false; end if;
 end loop;
 -- Receipts live inside AuthorityStore, never at the snapshot root.
 old_rows:=coalesce(p_old #> '{authority,settlement_postings}','[]'::jsonb);new_rows:=coalesce(p_new #> '{authority,settlement_postings}','[]'::jsonb);
 if jsonb_typeof(old_rows) is distinct from 'array' or jsonb_typeof(new_rows) is distinct from 'array' then return false; end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into prefix from jsonb_array_elements(new_rows) with ordinality e(value,ordinal) where ordinal<=jsonb_array_length(old_rows);
 if prefix is distinct from old_rows then return false; end if;
 old_rows:=coalesce(p_old #> '{authority,review_decisions}','[]'::jsonb);new_rows:=coalesce(p_new #> '{authority,review_decisions}','[]'::jsonb);
 if jsonb_typeof(new_rows) is distinct from 'array' or jsonb_array_length(new_rows)>1000 then return false; end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into prefix from jsonb_array_elements(new_rows) with ordinality e(value,ordinal) where ordinal<=jsonb_array_length(old_rows);
 if prefix is distinct from old_rows then return false; end if;
 if (select count(distinct r #>> '{record,request_id}') from jsonb_array_elements(new_rows) r)<>jsonb_array_length(new_rows) then return false; end if;
 old_rows:=coalesce(p_old #> '{authority,wallet_reservations}','[]'::jsonb);new_rows:=coalesce(p_new #> '{authority,wallet_reservations}','[]'::jsonb);
 if jsonb_typeof(new_rows) is distinct from 'array' then return false; end if;
 if (select count(distinct r->>'idempotency_key') from jsonb_array_elements(new_rows) r)<>jsonb_array_length(new_rows) then return false; end if;
 for prior in select value from jsonb_array_elements(old_rows) loop
  select value into current_row from jsonb_array_elements(new_rows) where value->>'idempotency_key'=prior->>'idempotency_key';
  if current_row is null or (prior-'state'-'updated_at') is distinct from (current_row-'state'-'updated_at') then return false; end if;
  if prior->>'state' in ('SETTLED','RELEASED') and current_row->>'state' is distinct from prior->>'state' then return false; end if;
  if prior->>'state'='EXPOSURE_UNKNOWN' and current_row->>'state' not in ('EXPOSURE_UNKNOWN','SETTLED','RELEASED') then return false; end if;
 end loop;
 for prior in select value from jsonb_array_elements(coalesce(p_old->'execution_ledger','[]'::jsonb)) loop
  select value into current_row from jsonb_array_elements(coalesce(p_new->'execution_ledger','[]'::jsonb)) where value->>'idempotency_key'=prior->>'idempotency_key';
  -- A posting must keep the actual established proof, not only its digest.
  -- Legacy SETTLED rows without proof may still acquire their first evidence.
  if prior->>'status'='SETTLED' and jsonb_typeof(prior->'provider_evidence')='object'
    and prior->'provider_evidence' is distinct from current_row->'provider_evidence' then return false; end if;
  -- Include newly admitted retirement events: the CAS which retires an
  -- existing predecessor cannot also rewrite it. No null-ref exception.
  if exists (select 1 from jsonb_array_elements(coalesce(p_new->'recovery_events','[]'::jsonb)) event
    where event->>'predecessor_key'=prior->>'idempotency_key' and event->>'obligation_id'=prior->>'obligation_id')
    and prior is distinct from current_row then return false; end if;
  if prior ? 'dispatch_evidence' and prior->'dispatch_evidence' is distinct from current_row->'dispatch_evidence' then return false; end if;
  old_rows:=coalesce(prior->'provider_observations','[]'::jsonb);new_rows:=coalesce(current_row->'provider_observations','[]'::jsonb);
  if jsonb_typeof(new_rows) is distinct from 'array' then return false; end if;
  select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into prefix from jsonb_array_elements(new_rows) with ordinality e(value,ordinal) where ordinal<=jsonb_array_length(old_rows);
  if prefix is distinct from old_rows then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function tameion_private.recovery_workflow_guard(jsonb,jsonb) from public,anon,authenticated,service_role;

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
  v_wallet text;
  v_wallet_namespace text;
  v_related_revision bigint;
  v_retirement jsonb;
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
  -- Disposition children, their immutable predecessors and late receipts under the predecessor identity.
  if not tameion_private.assessment_disposition_guard(v_current.snapshot, p_next_snapshot) then
    raise exception 'assessment disposition immutability violated';
  end if;

  if not tameion_private.recovery_workflow_guard(v_current.snapshot,p_next_snapshot) then
    return jsonb_build_object('accepted',false,'revision',v_current.revision);
  end if;

  -- Parent correction/review may retire a proven safe child only while its
  -- exact observed revision remains locked. Fresh child authorization makes
  -- this transition conflict before either namespace can dispatch again.
  for v_retirement in select value from jsonb_array_elements(coalesce(p_next_snapshot->'linked_retirement_checks','[]'::jsonb)) with ordinality entry(value,ordinal)
    where ordinal>jsonb_array_length(coalesce(v_current.snapshot->'linked_retirement_checks','[]'::jsonb)) order by value->>'namespace'
  loop
    if v_retirement->>'namespace'=p_namespace then raise exception 'INVALID_RETIREMENT_NAMESPACE'; end if;
    select revision into v_related_revision from tameion_private.demo_state where namespace=v_retirement->>'namespace' for update;
    if v_related_revision is null or v_related_revision::text is distinct from v_retirement->>'revision' then return jsonb_build_object('accepted',false,'revision',v_current.revision); end if;
  end loop;

  -- Cross-namespace contention is serialized on the shared payer wallet,
  -- before any new reservation is committed or provider dispatch is possible.
  for v_wallet in
    select distinct next_reservation.value->>'wallet_id' from jsonb_array_elements(coalesce(p_next_snapshot #> '{authority,wallet_reservations}','[]'::jsonb)) as next_reservation(value)
    where next_reservation.value->>'state' in ('RESERVED','EXPOSURE_UNKNOWN') and not exists (
      select 1 from jsonb_array_elements(coalesce(v_current.snapshot #> '{authority,wallet_reservations}','[]'::jsonb)) as prior_reservation(value)
      where prior_reservation.value->>'idempotency_key'=next_reservation.value->>'idempotency_key') order by 1
  loop
    if v_wallet is null or v_wallet='' then raise exception 'WALLET_IDENTITY_UNVERIFIED'; end if;
    insert into tameion_private.wallet_financial_namespace(wallet_id,namespace) values(v_wallet,p_namespace) on conflict(wallet_id) do nothing;
    select namespace into v_wallet_namespace from tameion_private.wallet_financial_namespace where wallet_id=v_wallet for update;
    if v_wallet_namespace is distinct from p_namespace then raise exception 'WALLET_NAMESPACE_CONFLICT'; end if;
  end loop;

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
      or coalesce(v_entry->>'review_decision_hash',v_entry->>'assessment_hash','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_entry->>'instruction_content_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_entry->>'source_obligation_id','') = '' or coalesce(v_entry->>'review_decision_id',v_entry->>'assessment_id','') = ''
      or jsonb_typeof(v_entry->'source_aggregate_version') is distinct from 'number'
      or coalesce(v_entry->>'source_amount','') !~ '^[0-9]+[.][0-9]{2}$'
      or coalesce(v_entry->>'source_currency','') !~ '^[A-Z]{3}$'
      or coalesce(v_entry->>'created_at','') = '' then raise exception 'malformed linked instruction'; end if;
    for v_field in select jsonb_object_keys(v_entry) loop
      if v_field not in ('schema_version','kind','status','organization_id','source_obligation_id','source_record_sha256','source_aggregate_version','assessment_id','assessment_hash','review_decision_id','review_decision_hash','instruction_id','attempt_id','source_amount','source_currency','network','classification','created_at','instruction_content_sha256') then raise exception 'unknown linked instruction field'; end if;
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
       or coalesce(v_entry #>> '{approval_record,review_decision_hash}',v_entry #>> '{approval_record,assessment_hash}', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_entry->>'approval_record_hash', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_entry->>'assurance_hash', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid append-only authorization entry';
    end if;
    if v_entry #>> '{approval_record,review_decision_id}' is not null then
      if v_entry #>> '{approval_record,assessment_id}' is not null
        or not exists (select 1 from jsonb_array_elements(coalesce(p_next_snapshot #> '{authority,review_decisions}','[]'::jsonb)) r
          where r->>'hash'=v_entry #>> '{approval_record,review_decision_hash}'
            and r #>> '{record,decision_id}'=v_entry #>> '{approval_record,review_decision_id}'
            and r #>> '{record,decision}'='ACCEPT_FOR_AUTHORIZATION') then raise exception 'invalid human authorization reference'; end if;
      insert into tameion_private.human_authorization_history(namespace,approval_id,review_decision_hash,authorization_record)
      values(p_namespace,v_entry #>> '{approval_record,approval_id}',v_entry #>> '{approval_record,review_decision_hash}',v_entry);
    else
    insert into tameion_private.authorization_history(
      namespace, approval_id, assessment_hash, approval_record_hash, assurance_hash, authorization_record
    ) values (
      p_namespace, v_entry #>> '{approval_record,approval_id}',
      v_entry #>> '{approval_record,assessment_hash}', v_entry->>'approval_record_hash',
      v_entry->>'assurance_hash', v_entry
    );
    end if;
  end loop;

  update tameion_private.demo_state
  set revision = revision + 1, snapshot = p_next_snapshot, updated_at = pg_catalog.now()
  where namespace = p_namespace;
  return jsonb_build_object('accepted', true, 'revision', v_current.revision + 1);
end;
$$;

revoke all on function public.tameion_state_compare_and_set(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.tameion_state_compare_and_set(text, bigint, jsonb) to service_role;

-- New financial/source writers fail closed until this migration is installed.
-- Existing history reads do not need the new write capability.
create or replace function public.tameion_recovery_capabilities()
returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('schema_version',1,'human_authorization_history',true,'shared_wallet_namespace_lock',true,'parent_child_retirement_lock',true,'immutable_recovery_receipts',true);
$$;
revoke all on function public.tameion_recovery_capabilities() from public,anon,authenticated;
grant execute on function public.tameion_recovery_capabilities() to service_role;
