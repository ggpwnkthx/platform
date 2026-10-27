/**
 * The theme of the console: the one of the system, light or dark.
 *
 * The choice is a cookie, so that the server renders the page in the
 * theme the reader chose and the page never flashes the other one.
 */

import { useState } from 'hono/jsx'

type Theme = 'system' | 'light' | 'dark'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Theme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }

export default function ThemeToggle(props: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(props.initial)

  const choose = () => {
    const next = NEXT[theme]
    setTheme(next)
    const root = document.documentElement
    if (next === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', next)
    // biome-ignore lint/suspicious/noDocumentCookie: the theme is a preference of the reader, read by the server.
    document.cookie = `console_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`
  }

  return (
    <button
      type="button"
      class="button quiet small"
      onClick={choose}
      title="Change the theme of the console"
      aria-label={`Theme: ${LABEL[theme]}. Change it.`}
    >
      Theme: {LABEL[theme]}
    </button>
  )
}
