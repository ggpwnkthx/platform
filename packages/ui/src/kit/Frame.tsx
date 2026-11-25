import {
  Box,
  ButtonBase,
  Drawer,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  useMediaQuery,
} from '@mui/material'
import {
  Database,
  History,
  LogOut,
  Menu as MenuIcon,
  Rows3,
  TerminalSquare,
  Users,
} from 'lucide-react'
import { type ReactNode, Suspense, useEffect, useState } from 'react'
import { Loading, TitlePortal, useLogout } from 'react-admin'
import { Link, useLocation } from 'react-router-dom'
import tokens from 'virtual:design-tokens'
import { useSession, useSigned } from '../session/session.ts'
import { iconSize } from './marks.tsx'
import { HeaderRight, HeaderSlot } from './Header.tsx'
import { Pane } from './Pane.tsx'
import { useWorkspace } from './place.ts'

const { layout, colors, rounded } = tokens
const modules = [
  ['Data', Rows3, (ws: string) => `/w/${ws}`, /^\/(w\/|[^/]+\.)|^\/$/],
  ['Users and groups', Users, () => '/roles', /^\/roles/],
  ['Activity', History, (ws: string) => `/activity/${ws}`, /^\/activity/],
  ['SQL', TerminalSquare, () => '/sql', /^\/sql/],
] as const
const tile = {
  width: layout['module-tile'],
  height: layout['module-tile'],
  borderRadius: rounded.sm,
  display: 'grid',
  placeItems: 'center',
}

/** The frame every page is drawn in. Signed out, there is no page to frame. */
export const Frame = ({ children }: { children: ReactNode }) =>
  useSigned() ? <Framed>{children}</Framed> : null

/** The module bar, the navigation pane, the header, the page. */
function Framed({ children }: { children: ReactNode }) {
  const { identity } = useSession()
  const { pathname } = useLocation()
  const workspace = useWorkspace()
  const logout = useLogout()
  const ws = workspace?.name ?? ''
  // The pane belongs to the modules that are read one workspace at a time. On a narrow screen
  // it is a drawer the menu button opens, and going somewhere closes it.
  const wide = useMediaQuery((theme) => theme.breakpoints.up('md'))
  const [menu, setMenu] = useState(false)
  const [who, setWho] = useState<HTMLElement | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new address closes the drawer
  useEffect(() => setMenu(false), [pathname])
  const pane = /^\/(roles|sql)/.test(pathname) ? null : <Pane ws={ws} />
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="nav"
        aria-label="Modules"
        sx={{
          width: layout['module-bar'],
          flex: 'none',
          bgcolor: colors['module-ink'],
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1.5,
          py: 2.5,
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <Box sx={{ ...tile, bgcolor: colors['ink-raised'], color: colors['studio-orange'], mb: 2 }}>
          <Database size={iconSize * 1.25} />
        </Box>
        {pane && !wide && (
          <ButtonBase
            aria-label="Menu"
            onClick={() => setMenu(true)}
            sx={{ ...tile, color: colors.paper }}
          >
            <MenuIcon size={iconSize * 1.25} />
          </ButtonBase>
        )}
        {modules.map(([label, Icon, to, here]) => {
          const active = here.test(pathname)
          return (
            <Tooltip key={label} title={label} placement="right">
              <ButtonBase
                component={Link}
                to={to(ws)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                sx={{
                  ...tile,
                  color: active ? colors['studio-black'] : colors['palette-grey'],
                  bgcolor: active ? colors['studio-orange'] : 'transparent',
                  '&:hover': active ? {} : { bgcolor: colors['ink-raised'] },
                }}
              >
                <Icon size={iconSize * 1.25} />
              </ButtonBase>
            </Tooltip>
          )
        })}
        <Tooltip title={identity.username} placement="right">
          <ButtonBase
            aria-label="You"
            onClick={(event) => setWho(event.currentTarget)}
            sx={{
              ...tile,
              ...tokens.typography.label,
              mt: 'auto',
              borderRadius: rounded.round,
              bgcolor: colors.paper,
              color: colors['studio-black'],
            }}
          >
            {identity.username.slice(0, 2).toUpperCase()}
          </ButtonBase>
        </Tooltip>
        <Menu anchorEl={who} open={!!who} onClose={() => setWho(null)}>
          <MenuItem disabled sx={{ '&.Mui-disabled': { opacity: 1 } }}>
            <ListItemText
              primary="Signed in to PostgreSQL as"
              secondary={identity.username}
              slotProps={{ secondary: { className: 'mono' } }}
            />
          </MenuItem>
          <MenuItem onClick={() => logout()}>
            <LogOut size={iconSize} />
            &nbsp; Sign out
          </MenuItem>
        </Menu>
      </Box>
      {wide ? (
        pane
      ) : (
        <Drawer open={menu} onClose={() => setMenu(false)}>
          {pane}
        </Drawer>
      )}
      <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
        <Box
          component="header"
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            minHeight: layout.header,
            px: { xs: 4, md: 8 },
            py: { xs: 3, md: 0 },
            display: 'flex',
            // Under the pane's breakpoint the title keeps the first row; what the page is for
            // doing takes the second.
            flexWrap: { xs: 'wrap', md: 'nowrap' },
            alignItems: 'center',
            gap: 3,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          {/* react-admin wraps a title in spans of its own, and a view's title in one more that stays empty. */}
          <TitlePortal
            variant="h2"
            sx={{
              display: 'flex',
              flex: 1,
              minWidth: 0,
              '& span:not(.MuiBox-root)': { display: 'flex', flex: 1, minWidth: 0 },
              '& > span:not(:has(.MuiBox-root))': { display: 'none' },
            }}
          />
          <HeaderRight onSlot={setSlot} />
        </Box>
        <Box sx={{ px: { xs: 4, md: 8 }, pt: 6, pb: 12 }}>
          <HeaderSlot.Provider value={slot}>
            <Suspense fallback={<Loading />}>{children}</Suspense>
          </HeaderSlot.Provider>
        </Box>
      </Box>
    </Box>
  )
}
