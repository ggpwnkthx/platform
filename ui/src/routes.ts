/**
 * Every page of the interface. Each is generated as its own static file at build time, so a
 * bookmark, a new tab and a reload all land on a real page; inside the app, links move
 * between them without a reload, which is what keeps the token in memory.
 */
export type Module = 'content' | 'model' | 'access' | 'activity' | 'sql' | 'workspace'

export interface PageInfo {
  path: string
  title: string
  module: Module | null
}

export const pages: PageInfo[] = [
  { path: '/', title: 'Sign in', module: null },
  { path: '/content', title: 'Content', module: 'content' },
  { path: '/content/records', title: 'Records', module: 'content' },
  { path: '/content/item', title: 'Record', module: 'content' },
  { path: '/model', title: 'Data model', module: 'model' },
  { path: '/model/collection', title: 'Collection', module: 'model' },
  { path: '/model/new', title: 'New collection', module: 'model' },
  { path: '/workspace/new', title: 'New workspace', module: 'workspace' },
  { path: '/workspace/settings', title: 'Workspace settings', module: 'workspace' },
  { path: '/access', title: 'Roles', module: 'access' },
  { path: '/access/role', title: 'Role', module: 'access' },
  { path: '/access/policies', title: 'Row policies', module: 'access' },
  { path: '/activity', title: 'Activity', module: 'activity' },
  { path: '/sql', title: 'SQL', module: 'sql' },
]

export const pageOf = (path: string): PageInfo | undefined =>
  pages.find((p) => p.path === (path.replace(/\/+$/, '') || '/'))

/** The file a page is generated at. */
export const fileFor = (path: string) =>
  path === '/' ? 'index.html' : `${path.slice(1)}/index.html`
