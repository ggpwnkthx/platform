import { VERSION } from './version.ts'

/** What the platform's own commands are, and what each of them needs. */
export const HELP = `platform <command>
  migrate           Install or upgrade Platform ${VERSION} in a dedicated PostgreSQL 18 database.
                    Needs the token of its administrator.
  harden <local|k8s> [--keep-names|--restore]
                    Hide the role catalogs from ordinary connections, so that psql no longer
                    reads who belongs to which group. Needs the cluster superuser. --keep-names
                    leaves role names readable; --restore puts PostgreSQL's default back.
  apply <local|k8s> FILE... [--dir=DIR] [--administrator] [--dry-run]
                    Apply JSON manifests of users, groups, workspaces, collections, grants and
                    policies to a deployment, in one transaction. --dir applies what a folder
                    says it applies in its platform.json, any folder that holds one: its
                    models.ts (the schema), then, beside the server, its migration.sql (what
                    a manifest cannot say) and, the first time, its demo.sql (records and
                    their history). --administrator makes the deployment's administrator
                    and nothing else. local is the local stack's published port; k8s uses the
                    settings below. Both need a token.
  model:apply FILE  Apply an additive JSON model using the caller's own DDL rights.
  sql FILE          Run a SQL file using the caller's own rights. Use BEGIN/COMMIT for atomic scripts.
  doctor            Check the server version, how it lets people in, and the installation, and
                    say what the deployment has left open: TLS, the role catalogs, collections
                    owned by a person, tables that write no revisions.
  lock ROLE         Take a role's login away (NOLOGIN) and end its open sessions: no token
                    logs it in until it is unlocked. For a person who has left, and for the
                    administrator between the times it is used.
  unlock ROLE       Give a role its login back. A superuser's is a superuser's to change: run
                    it beside the server, as \`deploy local admin unlock ROLE\` does.
  token [--out=FILE]
                    Sign in through OIDC_ISSUER in a browser and print a token for PGTOKEN,
                    psql or an Authorization: Bearer header. --out writes it to a file of
                    your own (mode 0600) for PGTOKEN_FILE, and prints nothing.
  deploy            Deploy locally with Docker/Podman or to Kubernetes. Run deploy help.
  ui                Build the interface as a static site, and serve it while it is worked on.
                    Run ui help.
  --version         Print the package version.
Database commands use DATABASE_HOST/PORT/NAME/SSL and act as the person whose token is in
PGTOKEN[_FILE]: \`platform token\` prints one. No login has a password. A DATABASE_HOST that is a
directory is the server's own socket, for a command that runs beside the server.`
