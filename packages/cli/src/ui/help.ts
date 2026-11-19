/** What the ui command can do, and what it needs. */
export const UI_HELP = `platform ui <build|dev> [options]

  build   Write the interface out as a static site: every page rendered to HTML, one client
          bundle, the styles, the fonts, config.json and the _headers file.
  dev     Write the site and serve it, rebuilding it on every change.
  --dir=DIR       The directory that holds platform.json. Default: the working directory.
  --production    Build the published interface, whatever the configuration says.
  --relay=HOST:PORT
                  With dev: serve the published interface and forward its /pg WebSockets to
                  a PostgreSQL at HOST:PORT, byte for byte, as the deployment's relay does.
  --port=PORT     The port dev serves on. Default: 5173.

  The configuration is platform.json, in the directory the command is pointed at:

    { "mode": "development", "database": "database.ts", "out": ".dist" }

  A development build replaces the interface's database seam with the module the
  configuration names, so that the pages and the bundle talk to the same PostgreSQL: the one
  that runs inside the page. Without a configuration, the interface is built as it is
  published: the real one, with the relay and the issuer.`
