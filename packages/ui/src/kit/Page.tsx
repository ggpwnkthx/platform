import { Box, Tab, Tabs, Typography } from '@mui/material'
import { Fragment, type ReactNode } from 'react'
import { Title } from 'react-admin'
import { useSearchParams } from 'react-router-dom'
import tokens from 'virtual:design-tokens'

export interface Heading {
  title: string
  crumb?: ReactNode
  mark?: ReactNode
  /** What the page is for doing, at the header's right: its one primary action first. */
  actions?: ReactNode
}
/** What a page is called, in the header: its mark, where it belongs, its name, and its actions. */
export function PageTitle(props: Heading) {
  return (
    <Title
      title={
        <Box
          component="span"
          sx={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, flex: 1 }}
        >
          {props.mark}
          <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
            {props.crumb && (
              <Typography
                component="span"
                variant="subtitle2"
                sx={{ display: 'block', color: 'text.secondary', '& a': { color: 'inherit' } }}
              >
                {props.crumb}
              </Typography>
            )}
            <Box
              component="span"
              sx={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {props.title}
            </Box>
          </Box>
          {props.actions && (
            <Box component="span" sx={{ display: 'flex', gap: 2, flex: 'none', p: 1 }}>
              {props.actions}
            </Box>
          )}
        </Box>
      }
    />
  )
}

/** A page of the platform's own: its title, its sections, and what is known beside them. */
export function Page({
  aside,
  children,
  ...heading
}: Heading & { aside?: ReactNode; children: ReactNode }) {
  const props = { aside, children }
  return (
    <Box sx={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <PageTitle {...heading} />
      <Box sx={{ flex: 1, minWidth: 0 }}>{props.children}</Box>
      {props.aside && <Aside>{props.aside}</Aside>}
    </Box>
  )
}
/** What is known about the thing in view, beside it: on the navigation pane's grey. */
export const Aside = ({ children }: { children: ReactNode }) => (
  <Box
    component="aside"
    sx={{
      width: tokens.layout.aside,
      flex: 'none',
      bgcolor: 'grey.100',
      borderRadius: tokens.rounded.md,
      p: 5,
      display: { xs: 'none', lg: 'flex' },
      flexDirection: 'column',
      gap: 5,
      ml: 6,
    }}
  >
    {children}
  </Box>
)
export const AsideGroup = (props: { title: string; children: ReactNode }) => (
  <Box>
    <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5 }}>
      {props.title}
    </Typography>
    {props.children}
  </Box>
)

/** The parts of a page too long to read at once, one at a time. The address says which. */
export function Tabbed({ tabs }: { tabs: Record<string, ReactNode> }) {
  const [params, setParams] = useSearchParams()
  const names = Object.keys(tabs)
  const at = names.find((name) => name === params.get('tab')) ?? names[0]!
  return (
    <>
      <Tabs
        value={at}
        variant="scrollable"
        onChange={(_event, tab) => setParams({ tab }, { replace: true })}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 6 }}
      >
        {names.map((name) => (
          <Tab key={name} value={name} label={name} />
        ))}
      </Tabs>
      {/* Each part is drawn afresh: a table never shows another's rows while its own are read. */}
      <Fragment key={at}>{tabs[at]}</Fragment>
    </>
  )
}
