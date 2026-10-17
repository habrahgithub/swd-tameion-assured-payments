create schema if not exists tameion_private;
revoke all on schema tameion_private from public, anon, authenticated;
grant usage on schema tameion_private to service_role;

create table tameion_private.demo_state (
  namespace text primary key check (length(namespace) between 1 and 96),
  revision bigint not null check (revision >= 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  updated_at timestamptz not null default pg_catalog.now()
);

create table tameion_private.assessment_history (
  namespace text not null references tameion_private.demo_state(namespace),
  organization_id text not null,
  obligation_id text not null,
  assessment_id text not null,
  assessment_hash text not null check (assessment_hash ~ '^[0-9a-f]{64}$'),
  assessment_record jsonb not null check (jsonb_typeof(assessment_record) = 'object'),
  recorded_at timestamptz not null default pg_catalog.now(),
  primary key (namespace, assessment_id),
  unique (namespace, organization_id, obligation_id, assessment_hash)
);

alter table tameion_private.demo_state enable row level security;
alter table tameion_private.assessment_history enable row level security;
revoke all on tameion_private.demo_state from public, anon, authenticated, service_role;
revoke all on tameion_private.assessment_history from public, anon, authenticated, service_role;

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
begin
  if p_namespace is null or length(p_namespace) not between 1 and 96
     or jsonb_typeof(p_initial_snapshot) is distinct from 'object'
     or jsonb_typeof(p_initial_snapshot #> '{authority,assessments}') is distinct from 'array' then
    raise exception 'invalid durable demo-state seed';
  end if;

  insert into tameion_private.demo_state(namespace, revision, snapshot)
  values (p_namespace, 1, p_initial_snapshot)
  on conflict (namespace) do nothing;

  select revision, snapshot into strict v_revision, v_snapshot
  from tameion_private.demo_state where namespace = p_namespace;

  for v_assessment in
    select value from jsonb_array_elements(v_snapshot #> '{authority,assessments}')
  loop
    insert into tameion_private.assessment_history(
      namespace, organization_id, obligation_id, assessment_id, assessment_hash, assessment_record
    ) values (
      p_namespace,
      v_assessment->>'organization_id',
      v_assessment->>'obligation_id',
      v_assessment #>> '{record,assessment_id}',
      v_assessment->>'hash',
      v_assessment->'record'
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
  v_prefix jsonb;
  v_count integer;
  v_assessment jsonb;
begin
  if p_namespace is null or p_expected_revision is null or p_expected_revision < 1
     or jsonb_typeof(p_next_snapshot) is distinct from 'object'
     or jsonb_typeof(p_next_snapshot #> '{authority,assessments}') is distinct from 'array' then
    raise exception 'invalid durable demo-state update';
  end if;

  select * into v_current
  from tameion_private.demo_state where namespace = p_namespace
  for update;

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

  for v_assessment in
    select value from jsonb_array_elements(v_new_assessments) with ordinality as entries(value, ordinal)
    where ordinal > v_count
  loop
    if jsonb_typeof(v_assessment) <> 'object'
       or jsonb_typeof(v_assessment->'record') <> 'object'
       or coalesce(v_assessment->>'organization_id', '') = ''
       or coalesce(v_assessment->>'obligation_id', '') = ''
       or coalesce(v_assessment #>> '{record,assessment_id}', '') = ''
       or coalesce(v_assessment->>'hash', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid append-only assessment entry';
    end if;
    insert into tameion_private.assessment_history(
      namespace, organization_id, obligation_id, assessment_id, assessment_hash, assessment_record
    ) values (
      p_namespace,
      v_assessment->>'organization_id',
      v_assessment->>'obligation_id',
      v_assessment #>> '{record,assessment_id}',
      v_assessment->>'hash',
      v_assessment->'record'
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
