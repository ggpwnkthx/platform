import { Box, Chip, Tooltip } from '@mui/material'
import type { Hold } from '@platform/core'
import { Globe, User, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import tokens from 'virtual:design-tokens'
import { ItemIcon, iconSize } from './icons.tsx'
import { tone } from './palette.ts'

export { ItemIcon, iconSize, isIcon, itemIcons } from './icons.tsx'

/** The signatures of the studio, drawn one way everywhere: marks, statements, refusals. */
const { colors, layout, rounded } = tokens
const px = (value: string) => Number.parseFloat(value)
/** An item's mark: a rounded tile of its own colour carrying its own icon, and nothing more. */
export function ItemMark(props: { icon?: string | null; color?: string | null; table?: boolean }) {
  const drawn = tone(props.color)
  return (
    <Box
      sx={{
        width: layout['item-mark'],
        height: layout['item-mark'],
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        borderRadius: rounded.sm,
        bgcolor: drawn?.fill ?? colors['subdued-grey'],
        color: drawn?.ink ?? colors['soft-text'],
      }}
    >
      <ItemIcon name={props.icon} size={px(layout['item-mark']!) / 2} table={props.table} />
    </Box>
  )
}

const holds = {
  all: 'held on the whole table',
  some: 'held on some columns',
  none: 'not held',
}
/** A privilege's tip: how much of it is held. */
const tipOf = (name: string, hold: Hold, count?: string) => {
  const [some, of] = count?.split('/') ?? []
  const held = hold === 'some' && some ? `held on ${some} of ${of} columns` : holds[hold]
  return `${name}: ${held}`
}
/** A privilege: PostgreSQL's own name beside a full, half or empty mark. It describes; it does not edit. */
export function Privilege(props: { name: string; held: Hold | boolean; count?: string }) {
  const hold = props.held === true ? 'all' : props.held === false ? 'none' : props.held
  const orange = colors['studio-orange']
  const disc = {
    all: { bgcolor: orange },
    some: {
      background: `linear-gradient(90deg, ${orange} 50%, ${colors['orange-wash-deep']} 50%)`,
    },
    none: { border: `${layout.ring} solid ${colors['palette-grey']}` },
  }[hold]
  return (
    <Tooltip title={tipOf(props.name, hold, props.count)} disableInteractive describeChild>
      <Box
        component="span"
        data-held={hold}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1.5,
          mr: 3,
          ...tokens.typography.privilege,
          color: hold === 'none' ? 'text.disabled' : 'text.primary',
        }}
      >
        <Box
          component="i"
          sx={{
            width: layout['privilege-mark'],
            height: layout['privilege-mark'],
            borderRadius: rounded.round,
            flex: 'none',
            ...disc,
          }}
        />
        {props.name}
        {props.count && hold === 'some' ? ` ${props.count}` : ''}
      </Box>
    </Tooltip>
  )
}
export const PrivilegeLegend = () => (
  <Box>
    <Privilege name="whole table" held="all" />
    <Privilege name="some columns" held="some" />
    <Privilege name="not held" held="none" />
  </Box>
)
/** A role, drawn the same wherever access is read: a person, a group or everyone, and its name. */
export function RoleName({ name, group }: { name: string; group?: boolean }) {
  const Icon = name.toLowerCase() === 'public' ? Globe : group ? Users : User
  return (
    <Box
      component="span"
      className="mono"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5 }}
    >
      <Icon size={iconSize} />
      {name}
    </Box>
  )
}
export const Mono = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="mono" title={title}>
    {children}
  </span>
)
/** A small pill that says one thing about a row. */
export const Tag = (props: {
  children: ReactNode
  color?: 'primary' | 'info' | 'success' | 'warning' | 'error'
}) => <Chip label={props.children} color={props.color ?? 'default'} />
