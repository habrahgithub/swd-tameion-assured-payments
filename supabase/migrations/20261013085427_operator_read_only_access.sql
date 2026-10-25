BEGIN;
-- PRIVATE #65 DESIGN IMPLEMENTATION. Do not enable before isolated grants,
-- concurrency and approved ingress/provisioning validation. No credentials.
CREATE TABLE tameion_private.operator_verifiers (
 operator_key text PRIMARY KEY CHECK(length(operator_key) BETWEEN 1 AND 128),
 enabled boolean NOT NULL, credential_version bigint NOT NULL CHECK(credential_version>0),
 algorithm text NOT NULL CHECK(algorithm='scrypt-v1'),
 salt bytea NOT NULL CHECK(octet_length(salt) BETWEEN 16 AND 64),
 verifier bytea NOT NULL CHECK(octet_length(verifier)=64),
 work_n bigint NOT NULL CHECK(work_n=131072),work_r integer NOT NULL CHECK(work_r=8),work_p integer NOT NULL CHECK(work_p=1),maxmem bigint NOT NULL CHECK(maxmem=167772160),changed_at timestamptz NOT NULL
);
CREATE TABLE tameion_private.operator_sessions (
 session_digest bytea PRIMARY KEY CHECK(octet_length(session_digest)=32),
 operator_key text NOT NULL REFERENCES tameion_private.operator_verifiers(operator_key),credential_version bigint NOT NULL CHECK(credential_version>0),csrf_digest bytea NOT NULL CHECK(octet_length(csrf_digest)=32),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '60 minutes')
);
CREATE TABLE tameion_private.auth_throttle (
 scope_digest bytea PRIMARY KEY CHECK(octet_length(scope_digest)=32),
 kind text NOT NULL CHECK(kind IN ('login_operator','login_network','login_pair','refresh_session','refresh_network','bootstrap_minute','bootstrap_window')),
 window_start timestamptz NOT NULL,attempts integer NOT NULL CHECK(attempts>=0),locked_until timestamptz
);
CREATE TABLE tameion_private.login_attempts (
 attempt_digest bytea PRIMARY KEY CHECK(octet_length(attempt_digest)=32),
 operator_key text NOT NULL REFERENCES tameion_private.operator_verifiers(operator_key),credential_version bigint NOT NULL CHECK(credential_version>0),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 seconds')
);
CREATE TABLE tameion_private.prelogin_challenges (
 challenge_id text PRIMARY KEY CHECK(challenge_id ~ '^[a-f0-9]{32}$'),binding_digest bytea NOT NULL UNIQUE CHECK(octet_length(binding_digest)=32),csrf_digest bytea NOT NULL CHECK(octet_length(csrf_digest)=32),network_digest bytea NOT NULL CHECK(octet_length(network_digest)=32),origin_digest bytea NOT NULL CHECK(octet_length(origin_digest)=32),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes')
);
CREATE INDEX prelogin_network_expiry ON tameion_private.prelogin_challenges(network_digest,expires_at);
ALTER TABLE tameion_private.operator_verifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tameion_private.operator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tameion_private.auth_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE tameion_private.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tameion_private.prelogin_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tameion_private.operator_verifiers,tameion_private.operator_sessions,tameion_private.auth_throttle,tameion_private.login_attempts,tameion_private.prelogin_challenges FROM PUBLIC,anon,authenticated,service_role;

-- Scope tuples are constructed solely by fixed public functions, never callers.
-- Serialize all scopes in byte order. Check every budget before charging any.
CREATE FUNCTION tameion_private.auth_charge(p_scopes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
DECLARE v jsonb;r tameion_private.auth_throttle%ROWTYPE;n timestamptz:=clock_timestamp();d bytea;wait_seconds integer:=0;
BEGIN
 FOR v IN SELECT value FROM jsonb_array_elements(p_scopes) ORDER BY value->>'digest' LOOP
  d:=decode(v->>'digest','hex');
  INSERT INTO tameion_private.auth_throttle(scope_digest,kind,window_start,attempts) VALUES(d,v->>'kind',n,0) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM tameion_private.auth_throttle WHERE scope_digest=d FOR UPDATE;
  IF r.locked_until>n THEN wait_seconds:=greatest(wait_seconds,ceil(extract(epoch FROM r.locked_until-n))::integer);
  ELSIF r.window_start+make_interval(secs=>(v->>'window')::integer)<=n THEN
   UPDATE tameion_private.auth_throttle SET window_start=n,attempts=0,locked_until=NULL WHERE scope_digest=d;
  ELSIF r.attempts>=(v->>'limit')::integer THEN
   UPDATE tameion_private.auth_throttle SET locked_until=n+make_interval(secs=>(v->>'lock')::integer) WHERE scope_digest=d;
   wait_seconds:=greatest(wait_seconds,(v->>'lock')::integer);
  END IF;
 END LOOP;
 IF wait_seconds>0 THEN RETURN jsonb_build_object('accepted',false,'retry_after',wait_seconds);END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_scopes) ORDER BY value->>'digest' LOOP
  UPDATE tameion_private.auth_throttle SET attempts=attempts+1 WHERE scope_digest=decode(v->>'digest','hex');
 END LOOP;
 RETURN jsonb_build_object('accepted',true);
END $$;
CREATE FUNCTION tameion_private.auth_scope(p_kind text,p_binding bytea,p_limit integer,p_window integer,p_lock integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
 SELECT jsonb_build_object('kind',p_kind,'digest',encode(sha256(convert_to(p_kind||':','UTF8')||p_binding),'hex'),'limit',p_limit,'window',p_window,'lock',p_lock)
$$;
REVOKE ALL ON FUNCTION tameion_private.auth_charge(jsonb),tameion_private.auth_scope(text,bytea,integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.tameion_operator_csrf_issue(p_challenge_id text,p_binding_digest bytea,p_csrf_digest bytea,p_network_digest bytea,p_origin_digest bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
DECLARE b jsonb;n timestamptz;active_count integer;
BEGIN
 IF p_challenge_id IS NULL OR p_challenge_id !~ '^[a-f0-9]{32}$' OR octet_length(p_binding_digest) IS DISTINCT FROM 32 OR octet_length(p_csrf_digest) IS DISTINCT FROM 32 OR octet_length(p_network_digest) IS DISTINCT FROM 32 OR octet_length(p_origin_digest) IS DISTINCT FROM 32 THEN RETURN jsonb_build_object('accepted',false);END IF;
 b:=tameion_private.auth_charge(jsonb_build_array(tameion_private.auth_scope('bootstrap_minute',p_network_digest,3,60,60),tameion_private.auth_scope('bootstrap_window',p_network_digest,20,900,900)));
 IF (b->>'accepted')::boolean IS NOT TRUE THEN RETURN b;END IF;
 n:=clock_timestamp();
 -- The network budget locks serialize concurrent challenge issuance.
 DELETE FROM tameion_private.prelogin_challenges WHERE challenge_id IN (SELECT challenge_id FROM tameion_private.prelogin_challenges WHERE expires_at<=n OR consumed_at IS NOT NULL ORDER BY expires_at,challenge_id LIMIT 32);
 SELECT count(*) INTO active_count FROM tameion_private.prelogin_challenges WHERE network_digest=p_network_digest AND consumed_at IS NULL AND expires_at>n;
 IF active_count>=2 THEN
  UPDATE tameion_private.prelogin_challenges SET consumed_at=n WHERE challenge_id IN (SELECT challenge_id FROM tameion_private.prelogin_challenges WHERE network_digest=p_network_digest AND consumed_at IS NULL AND expires_at>n ORDER BY created_at,challenge_id LIMIT (active_count-1));
 END IF;
 INSERT INTO tameion_private.prelogin_challenges VALUES(p_challenge_id,p_binding_digest,p_csrf_digest,p_network_digest,p_origin_digest,n,n+interval '5 minutes',NULL);
 RETURN jsonb_build_object('accepted',true,'expires_at',n+interval '5 minutes');
END $$;

CREATE FUNCTION public.tameion_operator_login_reserve(p_operator_key text,p_network_digest bytea,p_attempt_digest bytea,p_binding_digest bytea,p_csrf_digest bytea,p_origin_digest bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
DECLARE c tameion_private.prelogin_challenges%ROWTYPE;v tameion_private.operator_verifiers%ROWTYPE;b jsonb;n timestamptz;
BEGIN
 IF octet_length(p_network_digest) IS DISTINCT FROM 32 OR octet_length(p_attempt_digest) IS DISTINCT FROM 32 OR octet_length(p_binding_digest) IS DISTINCT FROM 32 OR octet_length(p_csrf_digest) IS DISTINCT FROM 32 OR octet_length(p_origin_digest) IS DISTINCT FROM 32 OR p_operator_key IS NULL OR length(p_operator_key)>128 THEN RETURN jsonb_build_object('admitted',false);END IF;
 SELECT * INTO c FROM tameion_private.prelogin_challenges WHERE binding_digest=p_binding_digest FOR UPDATE;
 n:=clock_timestamp();
 IF NOT FOUND OR c.consumed_at IS NOT NULL OR c.expires_at<=n OR c.csrf_digest<>p_csrf_digest OR c.network_digest<>p_network_digest OR c.origin_digest<>p_origin_digest THEN RETURN jsonb_build_object('admitted',false);END IF;
 UPDATE tameion_private.prelogin_challenges SET consumed_at=n WHERE challenge_id=c.challenge_id;
 b:=tameion_private.auth_charge(jsonb_build_array(
  tameion_private.auth_scope('login_operator',sha256(convert_to(p_operator_key,'UTF8')),5,900,900),
  tameion_private.auth_scope('login_network',p_network_digest,20,900,900),
  tameion_private.auth_scope('login_pair',sha256(convert_to(p_operator_key,'UTF8')||p_network_digest),5,900,900)));
 IF (b->>'accepted')::boolean IS NOT TRUE THEN RETURN b||jsonb_build_object('admitted',false);END IF;
 SELECT * INTO v FROM tameion_private.operator_verifiers WHERE operator_key=p_operator_key FOR SHARE;
 IF NOT FOUND OR NOT v.enabled THEN RETURN jsonb_build_object('admitted',false);END IF;
 n:=clock_timestamp();
 INSERT INTO tameion_private.login_attempts VALUES(p_attempt_digest,p_operator_key,v.credential_version,n,n+interval '15 seconds',NULL);
 RETURN jsonb_build_object('admitted',true,'verifier',jsonb_build_object('algorithm',v.algorithm,'salt_hex',encode(v.salt,'hex'),'verifier_hex',encode(v.verifier,'hex'),'work_n',v.work_n,'work_r',v.work_r,'work_p',v.work_p,'maxmem',v.maxmem,'credential_version',v.credential_version));
END $$;

CREATE FUNCTION public.tameion_operator_login_finish(p_attempt_digest bytea,p_expected_credential_version bigint,p_verified boolean,p_session_digest bytea,p_csrf_digest bytea) RETURNS jsonb
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
 INSERT INTO tameion_private.operator_sessions VALUES(p_session_digest,a.operator_key,v.credential_version,p_csrf_digest,n,n+interval '60 minutes',NULL);
 RETURN jsonb_build_object('accepted',true,'expires_at',n+interval '60 minutes');
END $$;

CREATE FUNCTION public.tameion_operator_session_validate(p_session_digest bytea) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
 SELECT coalesce((SELECT jsonb_build_object('valid',true,'operator_key',s.operator_key,'credential_version',s.credential_version,'expires_at',s.expires_at,'csrf_digest',encode(s.csrf_digest,'hex'))
 FROM tameion_private.operator_sessions s JOIN tameion_private.operator_verifiers v ON v.operator_key=s.operator_key
 WHERE octet_length(p_session_digest)=32 AND s.session_digest=p_session_digest AND s.revoked_at IS NULL AND v.enabled AND s.credential_version=v.credential_version AND s.expires_at>statement_timestamp()),jsonb_build_object('valid',false))
$$;
CREATE FUNCTION public.tameion_operator_session_revoke(p_session_digest bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
BEGIN
 IF octet_length(p_session_digest) IS DISTINCT FROM 32 THEN RETURN jsonb_build_object('revoked',false);END IF;
 UPDATE tameion_private.operator_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE session_digest=p_session_digest;
 RETURN jsonb_build_object('revoked',true);
END $$;
CREATE FUNCTION public.tameion_operator_refresh_admit(p_session_digest bytea,p_network_digest bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
DECLARE s tameion_private.operator_sessions%ROWTYPE;v tameion_private.operator_verifiers%ROWTYPE;k text;
BEGIN
 IF octet_length(p_session_digest) IS DISTINCT FROM 32 OR octet_length(p_network_digest) IS DISTINCT FROM 32 THEN RETURN jsonb_build_object('accepted',false);END IF;
 SELECT operator_key INTO k FROM tameion_private.operator_sessions WHERE session_digest=p_session_digest;
 SELECT * INTO v FROM tameion_private.operator_verifiers WHERE operator_key=k FOR SHARE;
 SELECT * INTO s FROM tameion_private.operator_sessions WHERE session_digest=p_session_digest FOR UPDATE;
 IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp() OR v.enabled IS NOT TRUE OR s.credential_version<>v.credential_version THEN RETURN jsonb_build_object('accepted',false);END IF;
 RETURN tameion_private.auth_charge(jsonb_build_array(tameion_private.auth_scope('refresh_session',p_session_digest,1,5,5),tameion_private.auth_scope('refresh_network',p_network_digest,12,60,60)));
END $$;
CREATE FUNCTION public.tameion_state_load_existing(p_namespace text,p_expected_schema_version integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tameion_private AS $$
 SELECT coalesce((SELECT CASE WHEN p_expected_schema_version=2 AND d.snapshot->>'schema_version'='2' AND d.snapshot->'actor_authority_registry_initialized'='true'::jsonb AND jsonb_typeof(d.snapshot->'trusted_keys')='array' AND jsonb_typeof(d.snapshot->'actor_authorities')='array'
 THEN jsonb_build_object('revision',d.revision,'snapshot',d.snapshot) ELSE jsonb_build_object('code','MIGRATION_REQUIRED') END FROM tameion_private.demo_state d WHERE d.namespace=p_namespace AND length(p_namespace) BETWEEN 1 AND 128),jsonb_build_object('code','STATE_UNAVAILABLE'))
$$;
REVOKE ALL ON FUNCTION public.tameion_operator_csrf_issue(text,bytea,bytea,bytea,bytea),public.tameion_operator_login_reserve(text,bytea,bytea,bytea,bytea,bytea),public.tameion_operator_login_finish(bytea,bigint,boolean,bytea,bytea),public.tameion_operator_session_validate(bytea),public.tameion_operator_session_revoke(bytea),public.tameion_operator_refresh_admit(bytea,bytea),public.tameion_state_load_existing(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tameion_operator_csrf_issue(text,bytea,bytea,bytea,bytea),public.tameion_operator_login_reserve(text,bytea,bytea,bytea,bytea,bytea),public.tameion_operator_login_finish(bytea,bigint,boolean,bytea,bytea),public.tameion_operator_session_validate(bytea),public.tameion_operator_session_revoke(bytea),public.tameion_operator_refresh_admit(bytea,bytea),public.tameion_state_load_existing(text,integer) TO service_role;

COMMIT;
