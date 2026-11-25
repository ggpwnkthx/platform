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
 * The navigation pane: the workspace switcher, and the collections of the workspace in view.
 * In the activity module the same collections choose whose revisions are read.
 */
export function Pane({ ws }: { ws: string }) {
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
      aria-label="Workspace"
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
        value={ws}
        aria-label="Workspace"
        onChange={(event) =>
          navigate(
            `/${activity && event.target.value !== '+' ? 'activity' : 'w'}/${event.target.value}`
          )
        }
        sx={{ mb: 3 }}
      >
        {catalog.schemas.map((schema) => (
          <MenuItem key={schema.name} value={schema.name}>
            {names(schema.name).name}
          </MenuItem>
        ))}
        {identity.can_create_workspace && (
          <MenuItem value="+">
            <Plus size={iconSize} />
            &nbsp;Add a workspace
          </MenuItem>
        )}
      </Select>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', px: 3, py: 1.5 }}>
        Collections
      </Typography>
      <List disablePadding>
        {activity && item(`/activity/${ws}`, 'Every collection', <Layers size={iconSize} />)}
        {tablesIn(catalog, ws).map((table) =>
          item(
            activity ? `/activity/${ws}?table=${table.name}` : `/${ws}.${table.name}`,
            names(ws, table.name).name,
            <ItemIcon name={names(ws, table.name).icon} table />
          )
        )}
      </List>
      {!activity && (
        <>
          <Typography variant="subtitle2" sx={{ color: 'text.secondary', px: 3, py: 1.5, mt: 3 }}>
            Workspace
          </Typography>
          <List disablePadding>
            {item(`/w/${ws}`, 'Data model and access', <Settings2 size={iconSize} />)}
          </List>
        </>
      )}
    </Box>
  )
}
