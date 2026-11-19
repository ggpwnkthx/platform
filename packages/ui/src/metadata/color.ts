/**
 * The colour an item may carry. A colour is data: the owner of a workspace or of a collection
 * chooses it, and it marks that item's avatar — never a border, a heading or a ground.
 *
 * The studio draws its own palette, so a colour is resolved to one of the palette's families:
 * by name, by value, or — for a colour the palette does not hold — by the family nearest to
 * it. The ink on the fill is the family's own step, so the glyph always reads.
 */

/** The palette's black and white: the only two inks a colour is read with. */
export const paletteBlack = '#141414'
export const paletteWhite = '#fafafa'

export interface Family {
  name: string
  hex: string
}

/** The sixteen chromatic families of the pinned palette, in the order the designer wrote them. */
export const palette: Family[] = [
  { name: 'orange', hex: '#f15a2b' },
  { name: 'red', hex: '#ee2a3d' },
  { name: 'green', hex: '#6cbe4f' },
  { name: 'blue', hex: '#449fd8' },
  { name: 'amber', hex: '#f1ad29' },
  { name: 'indigo', hex: '#5e54a3' },
  { name: 'mint', hex: '#65c081' },
  { name: 'pink', hex: '#ed2c8f' },
  { name: 'steel', hex: '#5379a3' },
  { name: 'olive', hex: '#bebf4f' },
  { name: 'purple', hex: '#aa519f' },
  { name: 'cyan', hex: '#43c1d8' },
  { name: 'bronze', hex: '#be964e' },
  { name: 'violet', hex: '#8553a2' },
  { name: 'teal', hex: '#60c5bc' },
  { name: 'clay', hex: '#bf704e' },
]

/** The five families the chrome spends on meaning: action, information and the three statuses. */
export const studioFamilies = ['orange', 'blue', 'green', 'amber', 'red']

/**
 * The families reserved for categorical data. An item's colour is categorical data, so it is
 * drawn from these; the studio's own five stay for what they mean.
 */
export const reservedFamilies = palette.filter((family) => !studioFamilies.includes(family.name))

/** A colour as the metadata holds it: #rgb or #rrggbb. Anything else is no colour at all. */
export function parseColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null
}

/** How far apart two colours are, in the eye's rough arithmetic: red, green and blue. */
function distance(first: string, second: string): number {
  let total = 0
  for (const offset of [1, 3, 5]) {
    const a = parseInt(first.slice(offset, offset + 2), 16)
    const b = parseInt(second.slice(offset, offset + 2), 16)
    total += (a - b) ** 2
  }
  return total
}

/**
 * The family a colour belongs to: the one it names, the one it is, or — for a colour the
 * palette does not hold — the nearest one it holds.
 */
export function familyOf(value: unknown): Family | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (!text) return null
  const named = palette.find((family) => family.name === text)
  if (named) return named
  const hex = parseColor(text)
  if (!hex) return null
  const exact = palette.find((family) => family.hex === hex)
  if (exact) return exact
  let nearest: Family | null = null
  let smallest = Number.POSITIVE_INFINITY
  for (const family of palette) {
    const apart = distance(hex, family.hex)
    if (apart < smallest) {
      smallest = apart
      nearest = family
    }
  }
  return nearest
}

/** The class that draws an item's colour: the palette family it belongs to. */
export function toneClass(value: unknown): string {
  const family = familyOf(value)
  return family ? `tone-${family.name}` : ''
}
