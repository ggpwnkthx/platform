/** What the deploy command can do, and what it needs. */
export const DEPLOY_HELP = `platform deploy <local|k8s> <action> [options]

  local  Docker Compose or Podman Compose, using deploy/compose/compose.yaml.
    up          Build, start PostgreSQL 18 and Dex, install the database, then start the relay.
                The interface is not a container: it is a static site, published to a CDN.
    init        Build/start PostgreSQL and Dex and run the idempotent database installer only.
    ui          Build the static interface into packages/ui/dist and print what to publish.
    validate    Validate the Compose configuration without printing its secrets.
    build       Build the PostgreSQL, relay and installer images.
    status      Show containers.
    logs        Show logs; trailing Compose arguments are accepted (for example -f relay).
    down        Stop containers; volumes are retained unless you explicitly pass --volumes.
    --engine=auto|docker|podman  Default: auto. Also supports standalone Compose tools.
    --timeout=120              Startup timeout in seconds, per readiness check.
    POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE is the database administrator password. When
    neither is set, up/init/build/validate generate one and save it in .env for later runs.
    The relay receives no password. People sign in through Dex, at DEX_PORT
    (5556), and PostgreSQL takes only tokens from the relay's network. The stack's Dex
    keeps three example people: admin@example.com, alice@example.com and bob@example.com, whose
    passwords are PLATFORM_ADMIN_PASSWORD, ALICE_PASSWORD and BOB_PASSWORD, generated likewise.

  k8s    Kubernetes, using deploy/k8s/deployment.yaml and your current kubectl context.
    render      Print configured manifests without contacting a cluster.
    validate    Server-side dry run; needs the target cluster.
    diff        Show the server-side diff (exit 1 means differences).
    apply       Apply manifests and wait for deployment/platform-relay to roll out.
    status      Show deployment, service and pods.
    logs        Show deployment logs; trailing kubectl arguments are accepted.
    down        Delete the relay's deployment and service; PostgreSQL is external.
    --namespace=default        Namespace must already exist.
    --image=REGISTRY/platform-relay:2.2.0  Or PLATFORM_IMAGE: the relay image (Dockerfile target relay).
    --public-url=https://...        Or PUBLIC_URL: the address of the site, the only origin the relay allows.
    --oidc-issuer=https://...       Or OIDC_ISSUER: your Dex, which PostgreSQL must trust too.
    --database-host=HOST            Or DATABASE_HOST.
    --database-name=platform        Or DATABASE_NAME.
    --database-port=5432            Or DATABASE_PORT.
    --timeout=120                   Rollout timeout in seconds.
    PostgreSQL 18 and Dex are yours to run. Install the database separately with your own
    operator credentials. Each pod runs the relay that forwards to DATABASE_HOST:DATABASE_PORT;
    set PLATFORM_TOKEN_ONLY_FROM (or your own pg_hba rule) to the pods' address range, so that
    from there PostgreSQL accepts tokens and nothing else. The interface is a static site you
    publish to a CDN; deploy/k8s/ingress.yaml is an example of the address it reaches the
    relay at.

  bun run cli deploy local up
  bun run cli deploy local logs -f relay
  bun run cli deploy local ui
  bun run cli deploy k8s apply --namespace=platform --image=registry/platform-relay:2.2.0 \\
    --public-url=https://platform.example.com --database-host=db.example.com \\
    --oidc-issuer=https://sso.example.com/dex
`
