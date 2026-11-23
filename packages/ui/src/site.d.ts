declare module 'virtual:platform-site' {
  /** The dev mode's in-page PostgreSQL, or null in the published interface. */
  export const startInPage: import('./session/types.ts').InPage | null
}
