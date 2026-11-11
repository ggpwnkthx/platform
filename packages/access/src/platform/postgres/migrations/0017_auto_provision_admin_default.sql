-- The first identity of a tenant administers it, unless the tenant says
-- otherwise (spec §6.4).
--
-- The flag was off by default: a tenant that was created without naming
-- it kept its administration for the operator of the platform, and the
-- first person who signed in was nothing. The flag is on by default now:
-- a new tenant hands the administration of itself to the first identity
-- that signs in at it, and the operator of the tenant turns it off when
-- the roster is hand-made.
--
-- The rows that are already written keep the value they hold: the
-- default is the value of a tenant that is created, and a tenant that
-- exists keeps the administration it has. The change of a flag is the
-- work of the operator of the tenant, and it is audited.

alter table tenants alter column auto_provision_admin set default true;
