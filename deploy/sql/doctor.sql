-- What a deployment has left open: how the server lets people in, and what its tables
-- lack. Run as whoever is to be told — a superuser is told everything:
--
--   psql -f deploy/sql/doctor.sql
--
-- Each row is a problem, a note, or a check that passed; a check the caller has no right to
-- make is said as skipped. Nothing is changed.
CREATE FUNCTION pg_temp.doctor() RETURNS TABLE(finding text, said text)
LANGUAGE plpgsql AS $$
DECLARE
  rule record;
  open_rules int := 0;
  names text;
BEGIN
  RETURN QUERY SELECT 'ok', format('%s on PostgreSQL %s, platform %s, as %s', current_database(),
    current_setting('server_version'), (SELECT version FROM platform.installation), session_user);
  BEGIN
    IF coalesce(current_setting('oauth_validator_libraries', true), '') = '' THEN
      RETURN QUERY SELECT 'problem', 'oauth_validator_libraries is empty: no token validator';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_hba_file_rules WHERE auth_method = 'oauth') THEN
      RETURN QUERY SELECT 'problem', 'pg_hba.conf has no oauth rule: nobody can sign in with a token';
    END IF;
    FOR rule IN SELECT * FROM pg_hba_file_rules WHERE type IS DISTINCT FROM 'local' ORDER BY rule_number LOOP
      IF rule.error IS NOT NULL THEN
        open_rules := open_rules + 1;
        RETURN QUERY SELECT 'problem', format('pg_hba.conf rule %s: %s', rule.rule_number, rule.error);
      ELSIF rule.auth_method NOT IN ('oauth', 'reject') THEN
        open_rules := open_rules + 1;
        RETURN QUERY SELECT 'problem', format('pg_hba.conf rule %s: %s %s %s lets logins in without a token',
          rule.rule_number, rule.type, array_to_string(rule.user_name, ','), rule.auth_method);
      END IF;
    END LOOP;
    IF open_rules = 0 THEN RETURN QUERY SELECT 'ok', 'Authentication rules: network logins are by token.'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN QUERY SELECT 'skipped', 'Authentication rules: reading them needs a superuser or pg_read_all_settings.';
  END;
  IF current_setting('ssl') = 'off' THEN
    RETURN QUERY SELECT 'note', 'TLS is off on this server: every token reaches it in the clear. That is for a server on the same machine or a network you would trust with a token.';
  END IF;
  IF has_table_privilege('public', 'pg_catalog.pg_auth_members', 'SELECT') THEN
    RETURN QUERY SELECT 'problem', 'Every connection reads the role catalogs: who belongs to which group. deploy/sql/harden.sql hides them from ordinary connections.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname IN ('platform_guard_start', 'platform_guard_end')) THEN
    RETURN QUERY SELECT 'problem', 'No guard on row security: deploy/sql/guard.sql refuses an ordinary owner whatever would turn a table out of row security, or let writes pass by the triggers that write its history.';
  END IF;
  BEGIN
    SELECT string_agg(format('%I.%I (%s)', n.nspname, c.relname, r.rolname), ', ' ORDER BY 1) INTO names
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
     WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('platform','information_schema') AND n.nspname !~ '^pg_'
       AND r.rolcanlogin AND NOT r.rolsuper;
    IF names IS NOT NULL THEN
      RETURN QUERY SELECT 'note', 'Owned by a person, who is not held to its row security: ' || names || '. A NOLOGIN group that owns a table owns it for its members.';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN QUERY SELECT 'skipped', 'Who owns the tables: the role catalogs are hidden from you.';
  END;
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY 1) INTO names
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('platform','information_schema') AND n.nspname !~ '^pg_'
     AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                        AND t.tgfoid = to_regprocedure('platform.record_change()') AND (t.tgtype & 28) <> 0
                        AND t.tgenabled IN ('O','A'));
  IF names IS NOT NULL THEN
    RETURN QUERY SELECT 'note', 'No enabled audit trigger, so writes leave no revision: ' || names || '. Tables made by platform.create_table carry one.';
  END IF;
END $$;
SELECT * FROM pg_temp.doctor();
