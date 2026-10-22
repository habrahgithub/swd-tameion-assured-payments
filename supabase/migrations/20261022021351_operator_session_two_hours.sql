BEGIN;
-- Forward-only, app-compatible-first activation. No existing session is renewed.
LOCK TABLE tameion_private.operator_sessions IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE operator_session_expected_ttl (
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 CHECK (expires_at>created_at AND expires_at<=created_at+interval '60 minutes')
) ON COMMIT DROP;
DO $guard$
DECLARE names text[]; actual text; expected text; created smallint; expiry smallint;
BEGIN
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='tameion_private.operator_sessions'::regclass AND attnum>0 AND NOT attisdropped)<>7 THEN RAISE EXCEPTION 'Unexpected operator session schema'; END IF;
 SELECT attnum INTO STRICT created FROM pg_attribute WHERE attrelid='tameion_private.operator_sessions'::regclass AND attname='created_at' AND atttypid='timestamptz'::regtype AND attnotnull AND NOT attisdropped;
 SELECT attnum INTO STRICT expiry FROM pg_attribute WHERE attrelid='tameion_private.operator_sessions'::regclass AND attname='expires_at' AND atttypid='timestamptz'::regtype AND attnotnull AND NOT attisdropped;
 SELECT array_agg(conname ORDER BY conname) INTO names FROM pg_constraint WHERE conrelid='tameion_private.operator_sessions'::regclass AND contype='c' AND conkey && ARRAY[created,expiry];
 IF cardinality(names) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Expected exactly one original session TTL constraint'; END IF;
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT actual FROM pg_constraint WHERE conrelid='tameion_private.operator_sessions'::regclass AND conname=names[1] AND convalidated AND NOT connoinherit;
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT expected FROM pg_constraint WHERE conrelid='pg_temp.operator_session_expected_ttl'::regclass AND contype='c';
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Unexpected original session TTL semantics'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.tameion_operator_login_finish(bytea,bigint,boolean,bytea,bytea)'::regprocedure AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, tameion_private'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='ea629b87e576e619094af735ad9356d4ee2ff1fffb1bd3549aa8ad567112495b') THEN RAISE EXCEPTION 'Unexpected original login finish definition'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.tameion_operator_refresh_admit(bytea,bytea)'::regprocedure AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, tameion_private'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='0bb66ee6c795475600ec3be2af5aec1930a16d689fc57d98b7cfe7a282a7cdce') THEN RAISE EXCEPTION 'Unexpected original refresh admit definition'; END IF;
 EXECUTE format('ALTER TABLE tameion_private.operator_sessions DROP CONSTRAINT %I',names[1]);
END $guard$;
ALTER TABLE tameion_private.operator_sessions ADD CONSTRAINT operator_sessions_fixed_two_hour_ttl
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '120 minutes');

CREATE OR REPLACE FUNCTION public.tameion_operator_login_finish(p_attempt_digest bytea,p_expected_credential_version bigint,p_verified boolean,p_session_digest bytea,p_csrf_digest bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
DECLARE a tameion_private.login_attempts%ROWTYPE;v tameion_private.operator_verifiers%ROWTYPE;n timestamptz;k text;
BEGIN
 IF octet_length(p_attempt_digest) IS DISTINCT FROM 32 OR octet_length(p_session_digest) IS DISTINCT FROM 32 OR octet_length(p_csrf_digest) IS DISTINCT FROM 32 THEN RETURN jsonb_build_object('accepted',false);END IF;
 SELECT operator_key INTO k FROM tameion_private.login_attempts WHERE attempt_digest=p_attempt_digest;
 SELECT * INTO v FROM tameion_private.operator_verifiers WHERE operator_key=k FOR SHARE;
 SELECT * INTO a FROM tameion_private.login_attempts WHERE attempt_digest=p_attempt_digest FOR UPDATE;
 n:=clock_timestamp();
 IF NOT FOUND OR a.consumed_at IS NOT NULL OR a.expires_at<=n THEN RETURN jsonb_build_object('accepted',false);END IF;
 UPDATE tameion_private.login_attempts SET consumed_at=n WHERE attempt_digest=p_attempt_digest;
 -- NULL or nonpositive expected versions must deny, never fall through SQL three-valued logic.
 IF p_verified IS NOT TRUE OR v.enabled IS NOT TRUE
 OR p_expected_credential_version IS NULL OR p_expected_credential_version<=0
 OR v.credential_version IS DISTINCT FROM p_expected_credential_version
 OR a.credential_version<>v.credential_version THEN RETURN jsonb_build_object('accepted',false);END IF;
 INSERT INTO tameion_private.operator_sessions VALUES(p_session_digest,a.operator_key,v.credential_version,p_csrf_digest,n,n+interval '120 minutes',NULL);
 RETURN jsonb_build_object('accepted',true,'expires_at',n+interval '120 minutes');
END $$;

CREATE OR REPLACE FUNCTION public.tameion_operator_refresh_admit(p_session_digest bytea,p_network_digest bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
DECLARE s tameion_private.operator_sessions%ROWTYPE;v tameion_private.operator_verifiers%ROWTYPE;k text;
BEGIN
 IF octet_length(p_session_digest) IS DISTINCT FROM 32 OR octet_length(p_network_digest) IS DISTINCT FROM 32 THEN RETURN jsonb_build_object('accepted',false);END IF;
 SELECT operator_key INTO k FROM tameion_private.operator_sessions WHERE session_digest=p_session_digest;
 SELECT * INTO v FROM tameion_private.operator_verifiers WHERE operator_key=k FOR SHARE;
 SELECT * INTO s FROM tameion_private.operator_sessions WHERE session_digest=p_session_digest FOR UPDATE;
 IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp() OR v.enabled IS NOT TRUE OR s.credential_version<>v.credential_version THEN RETURN jsonb_build_object('accepted',false);END IF;
 RETURN tameion_private.auth_charge(jsonb_build_array(tameion_private.auth_scope('refresh_session',p_session_digest,1,30,30),tameion_private.auth_scope('refresh_network',p_network_digest,12,60,60)));
END $$;

COMMIT;
