/** What the deploy command can do, and what it needs. */
export const DEPLOY_HELP = `platform deploy <local|k8s> <action> [options]

  local  Docker Compose or Podman Compose, using deploy/compose/compose.yaml.
    up          Build, start PostgreSQL 18 and Dex, install the database, then start the relay.
                The interface is not a container: it is a static site, published to a CDN.
    init        Build/start PostgreSQL and Dex and run the idempotent database installer only.
    admin CMD   Run an operator command beside PostgreSQL, through its own socket, as the
                server's superuser: admin doctor, admin harden k8s, admin lock ROLE, admin
                unlock ROLE. It reads no file of yours.
    ui          Build the static interface into packages/ui/dist and print what to publish.
    validate    Validate the Compose configuration without printing its secrets.
    build       Build the PostgreSQL, relay and installer images.
    status      Show containers.
    logs        Show logs; trailing Compose arguments are accepted (for example -f relay).
    down        Stop containers; volumes are retained unless you explicitly pass --volumes.
    --engine=auto|docker|podman  Default: auto. Also supports standalone Compose tools.
    --timeout=120              Startup timeout in seconds, per readiness check.
    --domain=DOMAIN            The domain the deployment is named by. Each service answers
                                on its own sub-domain of it: idp for Dex, api for the relay,
                                db for PostgreSQL. Default: localhost, which answers on this
                                machine. The names are put in this machine's hosts file, so
                                that the browser and your own tools can reach them.
                                The edge (Traefik) answers them on EDGE_PORT (8080) and
                                EDGE_TLS_PORT (4433), never on 80 or 443: a rootless
                                container cannot bind those.
    PostgreSQL has no password, for anyone: over the network it takes tokens from Dex and
    nothing else, and the installer reaches it through its socket. People sign in through Dex,
    at DEX_PORT (5556). The stack's Dex stands in for a real sign-in system, and it keeps one
    account with a password: the break-glass administrator, PLATFORM_ADMIN (admin@<domain>
    unless you name another: admin@localhost on a new checkout), whose
    PLATFORM_ADMIN_PASSWORD is generated into .env by up/init/build/validate. Every other
    account comes from a connector, an identity provider that vouches for the addresses it
    returns. up and init install the example the deployment chose, from examples/<name>: its
    models.json (the people, groups, workspaces, grants and row policies), its migration.sql
    (what a manifest cannot say) and, the first time, its demo.sql (records and their
    history). A deployment that chose no example is given its administrator's role alone.
    The settings of the stack live in .env at the root of the checkout. When that file is not
    there, the first run asks for what it does not know and writes the answers down, with the
    password it generated in it. The file holds secrets: it is written for you alone and
    kept out of git. It holds the pieces the deployment is made of — the domain, the
    sub-domains, the ports — and not the addresses: the issuer, the relay and the database
    are made of those pieces every time, so they never fall out of step with the domain. One
    question is a decision rather than a value: whether a site already exists. A site of your
    own is named by its full URL; left empty, an interface is deployed on a sub-domain of the
    domain above (app, unless you choose another) — one of the examples the checkout carries,
    or the platform's own interface. An example is built by up and served by the stack
    itself, behind the edge, at http://app.<domain>:<EDGE_PORT>: its files are the ones a CDN
    would be given, in examples/<name>/.dist.

  k8s    Kubernetes, using deploy/k8s/deployment.yaml and your current kubectl context.
    render      Print configured manifests without contacting a cluster.
    validate    Server-side dry run; needs the target cluster.
    diff        Show the server-side diff (exit 1 means differences).
    apply       Apply manifests and wait for deployment/platform-relay to roll out.
    status      Show deployment, service and pods.
    logs        Show deployment logs; trailing kubectl arguments are accepted.
    down        Delete the relay's deployment and service; PostgreSQL is external.
    --namespace=default        Namespace must already exist.
    --domain=DOMAIN            The domain the deployment is named by: each service answers
                                on its own sub-domain of it (idp, api, db). The issuer, the
                                relay's address and the database's address follow from it.
    --image=REGISTRY/platform-relay:2.3.0  Or PLATFORM_IMAGE: the relay image (Dockerfile target relay).
    --public-url=https://...        Or PUBLIC_URL: the address of the site, the only origin the relay allows.
    --oidc-issuer=https://...       Or OIDC_ISSUER: an issuer other than the deployment's own Dex.
    --database-host=HOST            Or DATABASE_HOST: a database other than the one on db.<domain>.
    --database-name=platform        Or DATABASE_NAME.
    --database-port=5432            Or DATABASE_PORT.
    --timeout=120                   Rollout timeout in seconds.
    PostgreSQL 18 and Dex are yours to run. Install the database separately, as the
    administrator the server names in PLATFORM_ADMIN, with a token from \`platform token\`.
    The settings of the deployment live in .env at the root of the checkout, like the local
    stack's: the first run asks for the image and the site's address, and writes them down,
    so that the flags are optional afterwards. The file holds the pieces — the domain, the
    sub-domains, the ports — and the issuer, the relay's address and the database's address
    are made of them every time.
    Each pod runs the relay that forwards to DATABASE_HOST:DATABASE_PORT; set
    PLATFORM_TOKEN_ONLY_FROM (or your own pg_hba rule) to the pods' address range, so that
    the administrator has no login through the relay, and PLATFORM_ADMIN_FROM to your
    operators' networks, so that it has none from anywhere else. The manifest reaches
    PostgreSQL in TLS (RELAY_UPSTREAM_TLS=verify). Behind an ingress, set
    RELAY_TRUSTED_PROXIES on the Deployment to the ingress controller's addresses, so that each
    reader's logins are counted against their own address. The interface is a static site you
    publish to a CDN; deploy/k8s/ingress.yaml is an example of the address it reaches the
    relay at.

  bun run cli deploy local up
  bun run cli deploy local logs -f relay
  bun run cli deploy local ui
  bun run cli deploy k8s apply --namespace=platform --image=registry/platform-relay:2.3.0 \\
    --public-url=https://platform.example.com --database-host=db.example.com \\
    --oidc-issuer=https://idp.platform.example.com
`
