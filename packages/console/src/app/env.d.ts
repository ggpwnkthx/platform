/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Whether the module was built by `vite build`, and not served by the server of the development. */
  readonly CONSOLE_BUILD: boolean
}
