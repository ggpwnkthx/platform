/**
 * The urls of the documentation of the console.
 *
 * The documentation is a place of the console, and every document of it
 * has an address of the console: `/docs/console/spec`. A link of a
 * document is rewritten to the address of its target, so that the
 * reader of the console walks the documentation the way the reader of
 * the repository walks it.
 *
 * A link that names a file that is not a document of the documentation
 * — a file of the repository, a package — is a link to the repository,
 * at the tag of the version the console carries: a tag is a name that
 * does not move.
 */

import { VERSION } from '../../runtime/version'
import type { Tree } from './tree'

/** The place of the documentation in the console. */
const PLACE = '/docs'

/** The repository of the platform. */
const REPOSITORY = 'https://github.com/ggpwnkthx/platform'

/** The url of a document of the documentation. */
export function urlOf(path: string): string {
  return `${PLACE}/${path}`
}

/**
 * The address that makes the reader read the documentation as a role,
 * then shows a page of it: the page the reader was on, or the home. The
 * role `all` reads as everyone.
 */
export function roleChoiceUrlOf(role: string, to: string | null): string {
  const query = new URLSearchParams({ role })
  if (to) query.set('to', to)
  return `${PLACE}?${query.toString()}`
}

/** The url of a file of the repository, at the tag of this version. */
export function sourceUrlOf(source: string): string {
  return `${REPOSITORY}/blob/v${VERSION}/${source}`
}

/**
 * The url of a link of a document.
 *
 * The link is named by the document it is in: a link of a document of
 * the console that names a place of the document it is in keeps the
 * place, and a link that names another document of the documentation
 * becomes the address of that document.
 */
export function resolveOf(tree: Tree, from: string, href: string): string {
  const target = targetOf(tree, from, href)
  if (target.kind === 'web') return target.href
  if (target.kind === 'repository') return `${sourceUrlOf(target.path)}${target.anchor}`
  return `${urlOf(target.path)}${target.anchor}`
}

/**
 * What a link of a document points at.
 *
 * - `document`: a document of the documentation, by its path (`gateway/spec`);
 * - `asset`: a file of the documentation that is not a document (`platform/atlas.html`);
 * - `repository`: any other file of the repository, by its path in the repository;
 * - `web`: a url.
 *
 * The anchor keeps its `#`, and is empty when the link names none.
 */
export type Target =
  | {
      readonly kind: 'document' | 'asset' | 'repository'
      readonly path: string
      readonly anchor: string
    }
  | { readonly kind: 'web'; readonly href: string }

/** The target of a link of the document at `from` (a path of the repository). */
export function targetOf(tree: Tree, from: string, href: string): Target {
  // A link that names a url is a link of the web, and not of the
  // documentation.
  if (/^[a-z]+:/i.test(href) || href.startsWith('//')) return { kind: 'web', href }
  const hash = href.indexOf('#')
  const target = hash === -1 ? href : href.slice(0, hash)
  const anchor = hash === -1 ? '' : href.slice(hash)
  if (target === '') return { kind: 'document', path: pathOf(from), anchor }
  const resolved = resolvePath(from, target)
  const document = tree.documents.find((item) => item.source === resolved)
  if (document) return { kind: 'document', path: document.path, anchor }
  const asset = tree.assets.find((item) => item.source === resolved)
  if (asset) return { kind: 'asset', path: asset.path, anchor }
  return { kind: 'repository', path: resolved, anchor }
}

/**
 * The path of a document, relative to the documentation.
 *
 * The path of the repository of a document is `docs/console/spec.md`,
 * and the path of the console of the same document is `console/spec`.
 */
function pathOf(source: string): string {
  return source.replace(/^docs\//, '').replace(/\.md$/, '')
}

/**
 * The path of the repository of a link, resolved against the document
 * the link is in.
 *
 * The path of the link is relative to the document it is in, and it may
 * leave the documentation: a link that names a file of the repository
 * resolves to a path of the repository.
 */
function resolvePath(from: string, target: string): string {
  const parts = from.split('/')
  parts.pop()
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}
