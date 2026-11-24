import tokens from 'virtual:design-tokens'

/**
 * The pinned palette: sixteen families, each a bright step that fills and a dark step that
 * carries text, read from DESIGN.md. A family is known by its last word: steel, mint, orange.
 */
const { colors } = tokens
export const palette: Record<string, [fill: string, ink: string]> = Object.fromEntries(
  Object.keys(colors)
    .filter((name) => `${name}-ink` in colors)
    .map((name) => [name.split('-').at(-1)!, [colors[name]!, colors[`${name}-ink`]!]])
)
const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
/** The family a colour belongs to: its own name, or the family nearest to it. */
export function familyOf(colour: unknown): string | null {
  if (typeof colour !== 'string') return null
  const text = colour.trim().toLowerCase()
  if (text in palette) return text
  if (!/^#[0-9a-f]{6}$/.test(text)) return null
  const distance = (family: string) =>
    rgb(palette[family]![0]).reduce((sum, part, at) => sum + (part - rgb(text)[at]!) ** 2, 0)
  return Object.keys(palette).sort((a, b) => distance(a) - distance(b))[0]!
}
/** A colour as the studio draws it: the fill, the text step, and the ink that reads on the fill. */
export function tone(colour: unknown): { fill: string; ink: string; text: string } | null {
  const family = familyOf(colour)
  if (!family) return null
  const [fill, text] = palette[family]!
  const [r, g, b] = rgb(fill)
  const light = 0.299 * r! + 0.587 * g! + 0.114 * b! > 140
  return { fill, text, ink: light ? colors['module-ink']! : colors.paper! }
}
