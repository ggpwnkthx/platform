import { Database, type LucideIcon, Table2 } from 'lucide-react'
import tokens from 'virtual:design-tokens'
import * as offered from './offered.ts'

export const iconSize = Number.parseFloat(tokens.layout.icon!)
/** The offered icons by the names lucide gives them: `BookOpen` is `book-open`. */
const drawn: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(offered).map(([name, icon]) => [
    name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase(),
    icon,
  ])
)
export const itemIcons = Object.keys(drawn)
/** A name outside the offered set is not an icon. */
export const isIcon = (name: unknown): name is string =>
  typeof name === 'string' && Object.hasOwn(drawn, name)
/** An item's icon by its name; a table without one is a table, a schema a database. */
export function ItemIcon(props: { name?: unknown; size?: number; table?: boolean }) {
  const Icon = isIcon(props.name) ? drawn[props.name]! : props.table ? Table2 : Database
  return <Icon size={props.size ?? iconSize} />
}
