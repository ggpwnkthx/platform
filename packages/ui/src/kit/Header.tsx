import { Box, ToggleButton, ToggleButtonGroup, Tooltip, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { createContext, Fragment, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import tokens from 'virtual:design-tokens'
import { iconAlone, wordsFromMd } from '../theme.ts'

/** The place at the header's right where what the page in view is for doing is drawn. */
export const HeaderSlot = createContext<HTMLElement | null>(null)
/**
 * The header's right, which the frame draws and the page in view fills. A button here is drawn
 * as its icon alone, a square of the control's height, whoever wrote it — react-admin's own
 * among them — and says its name to a screen reader and, in a tip, to the eye. The one primary
 * button keeps its words wherever there is room: what the page is for is read, not guessed.
 */
export const HeaderRight = (props: { onSlot(slot: HTMLElement | null): void }) => (
  <Box
    ref={props.onSlot}
    data-header-actions
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      flex: { xs: '1 1 100%', md: 'none' },
      minWidth: 0,
      overflowX: 'auto',
      '&:empty': { display: 'none' },
      '& .MuiButton-root': {
        minWidth: tokens.layout.control,
        width: tokens.layout.control,
        height: tokens.layout.control,
        px: 0,
        ...iconAlone,
        '& .MuiButton-startIcon, & .MuiButton-endIcon': { m: 0 },
      },
      '& .MuiButton-contained.MuiButton-colorPrimary': {
        width: { md: 'auto' },
        px: { md: 3 },
        ...wordsFromMd,
        '& .MuiButton-startIcon': { mr: { md: 1.5 } },
      },
      '& .ra-delete-button': { color: tokens.colors['danger-red-ink'] },
      // react-admin draws its filter button with Material's icon; it takes lucide's, as the rest,
      // from the site itself (`public/list-filter.svg`), which is all its policy lets images come from.
      '& .add-filter .MuiButton-startIcon, & .add-filter.MuiIconButton-root::before': {
        content: '""',
        width: tokens.layout.icon,
        height: tokens.layout.icon,
        bgcolor: 'currentColor',
        mask: 'url("/list-filter.svg") center / contain no-repeat',
        '& svg': { display: 'none' },
      },
      // On a phone react-admin draws it as a bare icon button: it keeps the header's square.
      '& .add-filter.MuiIconButton-root': {
        width: tokens.layout.control,
        height: tokens.layout.control,
        p: 0,
        border: 1,
        borderColor: 'divider',
        borderRadius: tokens.rounded.sm,
        color: tokens.colors['studio-black'],
        '& svg': { display: 'none' },
      },
    }}
  />
)
/**
 * The name of a header button whose label is its icon, shown on hover and on focus. The primary
 * button is `labelled` where there is room, and its tip is then not drawn twice.
 */
export function Tip(props: { title: string; labelled?: boolean; children: ReactNode }) {
  const roomy = useMediaQuery((theme: Theme) => theme.breakpoints.up('md'))
  return (
    <Tooltip title={props.labelled && roomy ? '' : props.title} disableInteractive>
      <Box component="span" sx={{ display: 'inline-flex', flex: 'none' }}>
        {props.children}
      </Box>
    </Tooltip>
  )
}
/**
 * Buttons for the header's right, from wherever on the page they belong. They keep the context
 * they are written in — a list's filters, a record's form — and leave with the part that drew them.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlot)
  return slot ? createPortal(children, slot) : null
}

/**
 * The parts of a page too long to read at once, one at a time, switched from the header: before
 * what the page is for doing, so its one primary button stays last. The address says which.
 */
export function Tabbed({
  tabs,
  icons,
}: {
  tabs: Record<string, ReactNode>
  /** Each part's icon: beside its name where there is room, alone with its name in a tip where not. */
  icons: Record<string, ReactNode>
}) {
  const [params, setParams] = useSearchParams()
  const roomy = useMediaQuery((theme: Theme) => theme.breakpoints.up('lg'))
  const names = Object.keys(tabs)
  const at = names.find((name) => name === params.get('tab')) ?? names[0]!
  return (
    <>
      <HeaderActions>
        <ToggleButtonGroup
          exclusive
          value={at}
          aria-label="Sections of the page"
          onChange={(_event, tab: string | null) => tab && setParams({ tab }, { replace: true })}
          sx={{
            order: -1,
            flex: 'none',
            '& .MuiToggleButton-root': {
              minWidth: tokens.layout.control,
              height: tokens.layout.control,
              p: 0,
              px: { lg: 3 },
              gap: 1.5,
            },
          }}
        >
          {names.map((name) => (
            <Tooltip key={name} title={roomy ? '' : name} disableInteractive>
              <ToggleButton value={name} aria-label={name}>
                {icons[name]}
                {roomy && name}
              </ToggleButton>
            </Tooltip>
          ))}
        </ToggleButtonGroup>
      </HeaderActions>
      {/* Each part is drawn afresh: a table never shows another's rows while its own are read. */}
      <Fragment key={at}>{tabs[at]}</Fragment>
    </>
  )
}
