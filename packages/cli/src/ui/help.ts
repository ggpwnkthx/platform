/** What the ui command can do, and what it needs. */
export const UI_HELP = `platform ui <build|dev|serve> [options]

  build   Write the interface out as a static site: every page rendered to HTML, one client
          bundle, the styles, the fonts, config.json and the _headers file.
  dev     Write the site and serve it, rebuilding it on every change.
  serve   Serve a site that is already built, as the files it is, with the headers its
          _headers file lists: --dir is the built site, --port defaults to 8080. It is what
          the local stack puts behind its edge for an example; a deployment uses a CDN.
  --dir=DIR       The directory that holds platform.json. Default: the working directory.
  --production    Build the published interface: the one that signs in through the issuer
                  and reaches PostgreSQL through the relay.
  --relay=HOST:PORT
                  With dev: serve the published interface and forward its /pg WebSockets to
                  a PostgreSQL at HOST:PORT, byte for byte, as the deployment's relay does.
  --port=PORT     The port dev serves on. Default: 5173.

  The configuration is platform.json, in the directory the command is pointed at. It says
  what the folder is, and every tool reads the same one:

    { "apply": { "models": "apply/models.json", "migration": "apply/migration.sql",
                 "demo": "apply/demo.sql" },
      "extensions": "extensions.tsx" }

  "apply" names what a database is brought to: the manifest, and the SQL beside it. A folder
  that has it is an example: \`apply --example\` applies those files to a deployment, and a
  build of the folder installs them in a PostgreSQL that runs inside the page, in the place
  of the interface's database seam, unless --production or --relay asks for the published
  interface. "extensions" names the site's own field types and renderers, registered with
  @platform/ui/fields/registry.ts and @platform/ui/fields/renderers.tsx: every build of the
  folder puts the module in the place of the interface's own, which is empty.

  The site is written to .dist in the folder. Without a configuration, the interface is
  built as it is published, in packages/ui/dist.

  Where a site runs is never in platform.json: the issuer, the relay and the database's name
  are the deployment's, read from its environment (PLATFORM_ISSUER, PLATFORM_RELAY_URL,
  PLATFORM_PUBLIC_URL, PLATFORM_CLIENT_ID, PLATFORM_CLAIM, PLATFORM_DATABASE_NAME,
  PLATFORM_STATEMENT_TIMEOUT_MS) and written to config.json and _headers by the build.`
