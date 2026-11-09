/**
 * The theme of the console: the one of the system, light or dark.
 *
 * The button is a sun and a moon: the moon is drawn in the light theme
 * and opens the dark one, the sun is drawn in the dark theme and opens
 * the light one. The choice is a cookie, so that the server renders the
 * page in the theme the reader chose and the page never flashes the
 * other one.
 */

import { useEffect, useState } from 'hono/jsx'

type Theme = 'system' | 'light' | 'dark'

/** The theme the page is really in: the one asked for, or the one of the system. */
function resolved(root: HTMLElement): 'light' | 'dark' {
  const asked = root.getAttribute('data-theme')
  if (asked === 'light' || asked === 'dark') return asked
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function ThemeToggle(props: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(props.initial)

  // The system theme is only known to the browser: the server cannot say
  // whether the page it renders is dark. The button waits for the browser
  // to tell it, and follows it while the theme is the one of the system.
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setTheme(resolved(root))
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  const choose = () => {
    const next = resolved(document.documentElement) === 'dark' ? 'light' : 'dark'
    setTheme(next)
    const root = document.documentElement
    root.setAttribute('data-theme', next)
    // biome-ignore lint/suspicious/noDocumentCookie: the theme is a preference of the reader, read by the server.
    document.cookie = `console_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`
  }

  // The system theme is not known before the browser answers, so the label
  // of the button stays general until then.
  const target = theme === 'system' ? null : theme === 'dark' ? 'light' : 'dark'
  const label = target ? `Switch to the ${target} theme` : 'Change the theme of the console'

  return (
    <button
      type="button"
      class="button quiet small theme-toggle"
      onClick={choose}
      title={label}
      aria-label={label}
    >
      {/* The moon is the way to the dark, the sun the way to the light. */}
      <svg
        class="theme-icon moon"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
      <svg
        class="theme-icon sun"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  )
}
