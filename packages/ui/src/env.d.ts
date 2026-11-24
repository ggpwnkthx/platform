/// <reference types="vite/client" />
declare module 'virtual:platform-site' {
  export const startInPage: import('./session/inpage.ts').InPage | null
}
declare module 'virtual:design-tokens' {
  const tokens: import('./tokens.ts').Tokens
  export default tokens
}
