import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Typography,
} from '@mui/material'
import { tablesIn } from '@platform/core'
import { Layers, Plus, Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import tokens from 'virtual:design-tokens'
import { useSession } from '../session/session.ts'
import { ItemIcon, iconSize } from './marks.tsx'
import { useNames } from './place.ts'

const { layout } = tokens
/**
 * The navigation pane: the schema switcher, and the tables of the schema in view.
 * In the activity module the same tables choose whose revisions are read.
 */
export function Pane({ schema }: { schema: string }) {
  const { catalog, identity } = useSession()
  const names = useNames()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const activity = pathname.startsWith('/activity')
  const at = decodeURIComponent(pathname + search)
  const item = (to: string, label: string, icon: ReactNode) => (
    <ListItemButton
      key={to}
      component={Link}
      to={to}
      selected={activity ? at === to : at.split('/')[1] === to.split('/')[1] && at.startsWith(to)}
    >
      <ListItemIcon sx={{ minWidth: 0, mr: 3, color: 'inherit' }}>{icon}</ListItemIcon>
      <ListItemText primary={label} slotProps={{ primary: { noWrap: true } }} />
    </ListItemButton>
  )
  return (
    <Box
      component="nav"
      aria-label="Schema"
      sx={{
        width: layout['nav-pane'],
        flex: 'none',
        bgcolor: 'grey.100',
        borderRight: 1,
        borderColor: 'divider',
        p: 3,
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflow: 'auto',
      }}
    >
      <Select
        fullWidth
        value={schema}
        aria-label="Schema"
        onChange={(event) =>
          navigate(
            `/${activity && event.target.value !== '+' ? 'activity' : 'schemas'}/${event.target.value}`
          )
        }
        sx={{ mb: 3 }}
      >
        {catalog.schemas.map((one) => (
          <MenuItem key={one.name} value={one.name}>
            {names(one.name).name}
          </MenuItem>
        ))}
        {identity.can_create_schema && (
          <MenuItem value="+">
            <Plus size={iconSize} />
            &nbsp;Create schema
          </MenuItem>
        )}
      </Select>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', px: 3, py: 1.5 }}>
        Tables
      </Typography>
      <List disablePadding>
        {activity && item(`/activity/${schema}`, 'Every table', <Layers size={iconSize} />)}
        {tablesIn(catalog, schema).map((table) =>
          item(
            activity ? `/activity/${schema}?table=${table.name}` : `/${schema}.${table.name}`,
            names(schema, table.name).name,
            <ItemIcon name={names(schema, table.name).icon} table />
          )
        )}
      </List>
      {!activity && (
        <>
          <Typography variant="subtitle2" sx={{ color: 'text.secondary', px: 3, py: 1.5, mt: 3 }}>
            Schema
          </Typography>
          <List disablePadding>
            {item(`/schemas/${schema}`, 'Definition and privileges', <Settings2 size={iconSize} />)}
          </List>
        </>
      )}
    </Box>
  )
}
