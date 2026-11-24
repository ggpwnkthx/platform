import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import { createTheme, type Theme } from '@mui/material/styles'
import tokens from 'virtual:design-tokens'
import { components } from './theme-components.ts'

/**
 * The design system as a theme. Every colour, size, space and shadow the interface draws is
 * read here from DESIGN.md's own frontmatter (`virtual:design-tokens`), and nowhere else: a
 * component names a token, never a value.
 */
const { colors: c, typography: t, rounded, shadows } = tokens
export const px = (value: string) => Number.parseFloat(value)
/** A status family: its bright step fills, its dark step is the text, its wash is the ground. */
const family = (name: string, contrastText = c.paper) => ({
  main: c[name]!,
  dark: c[`${name}-ink`]!,
  light: c[`${name}-wash`] ?? c[name]!,
  contrastText,
})
export const type = (name: string) => ({ ...t[name]!, fontSize: px(t[name]!.fontSize) })
/** Ink on wash: how a status is said everywhere but on the destructive button. */
const tones = {
  primary: 'studio-orange',
  info: 'signal-blue',
  success: 'success-green',
  warning: 'warning-amber',
  error: 'danger-red',
} as const
export const inkOnWash = (color: keyof typeof tones) => ({
  color: c[`${tones[color]}-ink`],
  backgroundColor: c[color === 'primary' ? 'orange-wash' : `${tones[color]}-wash`],
})
export const statuses = Object.keys(tones) as (keyof typeof tones)[]
const elevations = Array.from({ length: 25 }, (_, at) =>
  at === 0 ? 'none' : at < 4 ? shadows.rest : at < 8 ? shadows.lift : shadows.float
) as Theme['shadows']
export const formColumn = {
  '& .MuiFormControl-root, & .MuiAutocomplete-root': { width: '100%', margin: 0 },
  '& .MuiStack-root': { gap: tokens.spacing.md },
}
export const hairline = `1px solid ${c.hairline}`
export const mono = { fontFamily: t.value!.fontFamily, fontSize: px(t.value!.fontSize) }

export const theme = createTheme({
  spacing: 4,
  shape: { borderRadius: px(rounded.sm!) },
  shadows: elevations,
  palette: {
    mode: 'light',
    // The palette's black on orange: its white cannot sit on the bright step.
    primary: { ...family('studio-orange', c['studio-black']), dark: c['studio-orange-ink']! },
    secondary: { main: c['ink-raised']!, contrastText: c.paper! },
    info: family('signal-blue'),
    success: family('success-green'),
    warning: family('warning-amber'),
    error: family('danger-red'),
    text: { primary: c['studio-black']!, secondary: c['muted-text']!, disabled: c['faint-text']! },
    divider: c.hairline!,
    background: { default: c.paper!, paper: c.paper! },
    action: {
      hover: c['subdued-grey']!,
      selected: c['orange-wash']!,
      focus: c['orange-wash-deep']!,
    },
    grey: {
      100: c['subdued-grey']!,
      200: c.hairline!,
      400: c['palette-grey']!,
      900: c['module-ink']!,
    },
  },
  typography: {
    fontFamily: t.body!.fontFamily,
    fontSize: px(t.body!.fontSize),
    h1: type('display'),
    h2: type('headline'),
    ...Object.fromEntries(['h3', 'h4', 'h5', 'h6'].map((heading) => [heading, type('title')])),
    body1: type('body'),
    body2: type('body-small'),
    subtitle1: type('label'),
    subtitle2: type('label'),
    caption: type('body-small'),
    overline: { ...type('label'), textTransform: 'none' },
    button: { ...type('control'), textTransform: 'none' },
  },
  // Called here, once the helpers above exist: the two files name each other.
  components: components(),
})
