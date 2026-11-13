-- The policies of the delivery name the role of the delivery (spec §11).
--
-- The policies of `0004_isolation.sql` that name no role apply to every
-- role, and the policies of PostgreSQL are combined with a logical or:
-- a policy that holds every row of a table undoes the policy that holds
-- the rows of the scope. The role of the api therefore read the events
-- of every tenant, and wrote the deliveries of every tenant, whatever
-- the scope of its transaction was.
--
-- The fix names the role of each of the three policies, and the grant
-- of the select on the events is taken from the role of the api: the
-- api writes the events and never reads them. The worker of the
-- deliveries reads them, with the role of the delivery.
--
-- The policies of the owner and of the maintenance keep their roles, and
-- the policies of the scope keep the scope of the transaction.

drop policy outbox_events_delivery on platform.outbox_events;
create policy outbox_events_delivery on platform.outbox_events
  for all
  to data_delivery
  using (true)
  with check (false);

drop policy outbox_deliveries_delivery on platform.outbox_deliveries;
create policy outbox_deliveries_delivery on platform.outbox_deliveries
  for all
  to data_delivery
  using (true)
  with check (true);

drop policy workspaces_registry_read on platform.workspaces;
create policy workspaces_registry_read on platform.workspaces
  for all
  to data_registry
  using (true)
  with check (false);

-- The api writes the events and never reads them: the worker of the
-- deliveries reads them, with the role of the delivery.
revoke select on platform.outbox_events from data_runtime;
