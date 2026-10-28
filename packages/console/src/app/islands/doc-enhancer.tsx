/**
 * The behaviour of the documentation pages that needs the browser:
 * the copy buttons of the code blocks and the highlighted entry of the
 * outline as the reader scrolls.
 *
 * It renders nothing. The page is complete without it: the buttons stay
 * hidden and the outline plain.
 */

import { useEffect } from 'hono/jsx'

/** Shows the copy buttons of the code blocks and makes them copy. */
function enableCopy(): () => void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.code-block [data-copy]')]
  for (const button of buttons) button.hidden = false
  const onClick = async (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]')
    if (!button) return
    const code = button.closest('.code-block')?.querySelector('code')?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(code)
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Failed'
    }
    setTimeout(() => {
      button.textContent = 'Copy'
    }, 1500)
  }
  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}

/** Marks the entry of the outline whose section is being read. */
function enableScrollSpy(): () => void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.docs-toc a[href^="#"]')]
  if (links.length === 0 || !('IntersectionObserver' in window)) return () => {}
  const byId = new Map(links.map((link) => [decodeURIComponent(link.hash.slice(1)), link]))
  const headings = [...byId.keys()]
    .map((id) => document.getElementById(id))
    .filter((heading): heading is HTMLElement => heading !== null)
  const visible = new Set<string>()
  const mark = () => {
    // The first heading on screen, or the last one scrolled past.
    let active = headings.find((heading) => visible.has(heading.id))?.id
    if (!active) {
      const above = headings.filter((heading) => heading.getBoundingClientRect().top < 0)
      active = above[above.length - 1]?.id ?? headings[0]?.id
    }
    for (const [id, link] of byId) {
      if (id === active) link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    }
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      mark()
    },
    { rootMargin: '-72px 0px -60% 0px' }
  )
  for (const heading of headings) observer.observe(heading)
  mark()
  return () => observer.disconnect()
}

export default function DocEnhancer() {
  useEffect(() => {
    const stops = [enableCopy(), enableScrollSpy()]
    return () => {
      for (const stop of stops) stop()
    }
  }, [])
  return <span hidden />
}
