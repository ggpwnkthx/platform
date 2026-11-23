/** The pinned palette: every family's bright step, and the dark one that carries text. */
export const palette: Record<string, [fill: string, ink: string]> = {
  mint: ['#65c081', '#366745'],
  steel: ['#5379a3', '#2f445c'],
  cyan: ['#43c1d8', '#2a7785'],
  teal: ['#60c5bc', '#346c67'],
  pink: ['#ed2c8f', '#861b51'],
  purple: ['#aa519f', '#66305f'],
  violet: ['#8553a2', '#5a3a6d'],
  indigo: ['#5e54a3', '#3b3567'],
  olive: ['#bebf4f', '#6f6f2e'],
  bronze: ['#be964e', '#574422'],
  clay: ['#bf704e', '#804a33'],
  // The studio's own five come last: they already mean action, information and status.
  orange: ['#f15a2b', '#ad401e'],
  blue: ['#449fd8', '#3379a5'],
  green: ['#6cbe4f', '#3e702d'],
  amber: ['#f1ad29', '#7f5c24'],
  red: ['#ee2a3d', '#ab1d2b'],
}
const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
/** The family a colour belongs to: its name, or the nearest to a colour written as #rrggbb. */
export function familyOf(colour: unknown): string | null {
  if (typeof colour !== 'string') return null
  const text = colour.trim().toLowerCase()
  if (text in palette) return text
  if (!/^#[0-9a-f]{6}$/.test(text)) return null
  const distance = (family: string) =>
    rgb(palette[family]![0]).reduce((sum, part, at) => sum + (part - rgb(text)[at]!) ** 2, 0)
  return Object.keys(palette).sort((a, b) => distance(a) - distance(b))[0]!
}
/** The fill of a family and the ink that reads on it: the palette's black or its white. */
export function tone(colour: unknown): { fill: string; ink: string; text: string } | null {
  const family = familyOf(colour)
  if (!family) return null
  const [fill, text] = palette[family]!
  const [r, g, b] = rgb(fill)
  return { fill, text, ink: 0.299 * r! + 0.587 * g! + 0.114 * b! > 140 ? '#141414' : '#ffffff' }
}
