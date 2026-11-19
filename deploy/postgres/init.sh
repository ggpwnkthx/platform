# The first thing a new cluster is told, by the image's own entrypoint, over the container's
# socket. No login keeps a password: the one the cluster was made with is taken away. The
# administrator, if the deployment names one, is a role like any other person's, and signs in
# with a token whose claim names it.
psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname postgres \
  --set admin="${PLATFORM_ADMIN:-}" <<'SQL'
ALTER ROLE CURRENT_USER PASSWORD NULL;
SELECT format('CREATE ROLE %I LOGIN SUPERUSER', :'admin') WHERE :'admin' <> '' \gexec
SQL
