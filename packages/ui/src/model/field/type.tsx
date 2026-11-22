import clsx from 'clsx'
import {
  BooleanIcon,
  DateIcon,
  IntegerIcon,
  JsonIcon,
  MomentIcon,
  NumberIcon,
  RelationIcon,
  TagIcon,
  TextIcon,
  TimeIcon,
  UuidIcon,
} from '../../ui/icons.tsx'

const typeIcons: Record<string, typeof TextIcon> = {
  text: TextIcon,
  integer: IntegerIcon,
  bigint: IntegerIcon,
  decimal: NumberIcon,
  float: NumberIcon,
  boolean: BooleanIcon,
  date: DateIcon,
  time: TimeIcon,
  timestamp: MomentIcon,
  uuid: UuidIcon,
  json: JsonIcon,
  relation: RelationIcon,
}

/** The mark a type is drawn with: its own, or the mark of a type nobody has drawn. */
const iconOfType = (type: string): typeof TextIcon => typeIcons[type] ?? TagIcon

/** One type, offered as a choice: the mark it is drawn with, and its name. */
export function TypeChoice({
  type,
  label,
  chosen,
  prefix,
  onChoose,
}: {
  type: string
  label: string
  /** The type the field holds now. */
  chosen: string
  prefix: string
  onChoose: (type: string) => void
}) {
  const Icon = iconOfType(type)
  return (
    <label key={type} class={clsx('type-option', chosen === type && 'is-chosen')}>
      <input
        type="radio"
        name={`${prefix}-type`}
        value={type}
        checked={chosen === type}
        onChange={() => onChoose(type)}
      />
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}
