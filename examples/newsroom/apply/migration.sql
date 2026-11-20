-- What models.ts cannot say of the example: the edge cases. It is run after models.ts,
-- every time the example is applied, as the server's own superuser, so every statement here
-- leaves a database that already has it as it is.

-- What the workspaces, their collections and their fields say of themselves is written by
-- models.ts, and so is stamped with the installer's name. Each row is handed to whoever
-- owns the workspace, as if they had written it. The stamp is set aside meanwhile: it would
-- make the row the installer's again.
ALTER TABLE platform.item_metadata DISABLE TRIGGER USER;
UPDATE platform.item_metadata SET created_by = current_setting('deployment.admin'), updated_by = current_setting('deployment.admin')
 WHERE schema_name = 'newsroom' AND created_by = session_user;
UPDATE platform.item_metadata SET created_by = 'bob@example.com', updated_by = 'bob@example.com'
 WHERE schema_name = 'crm' AND created_by = session_user;
ALTER TABLE platform.item_metadata ENABLE TRIGGER USER;
