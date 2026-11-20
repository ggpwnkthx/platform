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
  { path: '/access/grants', title: 'Permissions', module: 'access' },
  { path: '/access/policies', title: 'Row policies', module: 'access' },
  { path: '/activity', title: 'Activity', module: 'activity' },
  { path: '/sql', title: 'SQL', module: 'sql' },
]

export const pageOf = (path: string): PageInfo | undefined =>
  pages.find((p) => p.path === (path.replace(/\/+$/, '') || '/'))

/**
 * The title the document carries at a path. A generated page is titled as it is built, but
 * a link inside the app moves between pages without loading one, so the title is said again
 * here. What follows the page's own name — the site's name, and whatever the build added to
 * it — is kept from the title the document already has.
 */
export function titleAt(path: string, current: string): string {
  const mark = current.indexOf(' · ')
  const site = mark < 0 ? ' · Platform' : current.slice(mark)
  return `${pageOf(path)?.title ?? 'Sign in'}${site}`
}

/** The file a page is generated at. */
export const fileFor = (path: string) =>
  path === '/' ? 'index.html' : `${path.slice(1)}/index.html`
