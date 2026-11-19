import { prerender } from 'preact-iso'
import { locationStub } from 'preact-iso/prerender'

/**
 * The interface, rendered as the browser would have it.
 *
 * The router's own prerenderer, and the same preact the interface is written against, so
 * that the markup is the markup the browser makes. Whoever builds the interface asks for
 * these pages: the interface knows how to be rendered, and the builder knows where to put
 * them.
 */

/** A page of the interface, rendered. */
export interface RenderedPage {
  /** Where the page lives, such as `/content`. */
  path: string
  /** The title the page carries. */
  title: string
  /** The file the page is written to, such as `content/index.html`. */
  file: string
  /** The page itself. */
  html: string
}

/**
 * Renders every page of the interface.
 *
 * The application is imported here, and not at the top, so that whoever builds the
 * interface may reshape it first: the pages are rendered with the same shape as the bundle.
 */
export async function renderPages(): Promise<RenderedPage[]> {
  const { fileFor, pages } = await import('./routes.ts')
  const { App } = await import('./app.tsx')
  const rendered: RenderedPage[] = []
  for (const { path, title } of pages) {
    locationStub(path)
    const { html } = await prerender(<App />)
    rendered.push({ path, title, file: fileFor(path), html })
  }
  return rendered
}
