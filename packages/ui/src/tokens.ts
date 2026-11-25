/** The shape of DESIGN.md's frontmatter, as the build hands it to the interface (`virtual:design-tokens`). */
export interface Type {
  fontFamily: string
  fontSize: string
  fontWeight: number
  lineHeight: number
  letterSpacing?: string
}
export interface Tokens {
  colors: Record<string, string>
  typography: Record<string, Type>
  rounded: Record<string, string>
  spacing: Record<string, string>
  shadows: Record<string, string>
  motion: Record<string, string>
  layout: Record<string, string>
  components: Record<string, Record<string, string>>
}
