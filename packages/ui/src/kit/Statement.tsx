import { Box, LinearProgress, Typography } from '@mui/material'
import { Check } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef } from 'react'
import tokens from 'virtual:design-tokens'
import { type Fault, pieces } from './diff.ts'

const { colors, layout, motion, rounded } = tokens
/** Where a statement stands: shown, running as the reader, committed, or refused. */
export type Standing = 'shown' | 'running' | 'ran' | 'refused'
const said: Record<Exclude<Standing, 'shown'>, string> = {
  running: 'Running as you…',
  ran: 'Ran as you, committed',
  refused: 'Refused, nothing changed',
}
const edge: Record<Standing, string> = {
  shown: colors.hairline!,
  running: colors['studio-orange']!,
  ran: colors['success-green']!,
  refused: colors['danger-red']!,
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The SQL a change runs, shown before the button that runs it. As the form changes, the words
 * it just wrote light up and settle; when PostgreSQL refuses, the statement and the word it
 * points at are marked where they stand.
 */
export function Statement(props: {
  sql: string[]
  caption?: string
  standing?: Standing
  fault?: Fault | null
}) {
  const { sql, fault } = props
  const standing = props.standing ?? 'shown'
  const key = sql.join('\0')
  const seen = useRef({ key, last: [] as string[], sql })
  if (seen.current.key !== key) seen.current = { key, last: seen.current.sql, sql }
  const last = fault ? sql : seen.current.last
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the statement's content.
  const drawn = useMemo(() => pieces(last, sql, fault), [key, fault?.statement, fault?.position])
  const pre = useRef<HTMLPreElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: lights what this change wrote, once.
  useLayoutEffect(() => {
    for (const lit of pre.current?.querySelectorAll<HTMLElement>('[data-fresh]') ?? [])
      lit.animate(
        [
          { backgroundColor: colors['orange-wash-deep'], color: colors['studio-orange-ink'] },
          {
            backgroundColor: colors['orange-wash'],
            color: colors['studio-orange-ink'],
            offset: 0.35,
          },
          { backgroundColor: 'transparent', color: colors['ink-raised'] },
        ],
        { duration: Number.parseFloat(motion.settle!), easing: motion['ease-out']! }
      )
  }, [key])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new mark is looked for once drawn.
  useLayoutEffect(() => {
    pre.current
      ?.querySelector('[data-fault]')
      ?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
  }, [drawn])
  if (!sql.length) return null
  return (
    <Box
      component="figure"
      data-statement
      data-standing={standing}
      sx={{
        m: 0,
        position: 'relative',
        border: 1,
        borderColor: edge[standing],
        borderRadius: rounded.sm,
        overflow: 'hidden',
        transition: `border-color ${motion.state} ${motion['ease-out']}`,
      }}
    >
      {standing === 'running' && (
        <LinearProgress
          aria-hidden
          sx={{ position: 'absolute', insetInline: 0, top: 0, height: 2, zIndex: 1 }}
        />
      )}
      <Typography
        component="figcaption"
        variant="subtitle2"
        aria-live="polite"
        sx={{
          px: 3.5,
          py: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          color:
            standing === 'ran'
              ? colors['success-green-ink']
              : standing === 'refused'
                ? colors['danger-red-ink']
                : 'text.secondary',
        }}
      >
        {standing === 'ran' && <Ticked />}
        <Box component="span" key={standing} sx={settling}>
          {standing === 'shown'
            ? (props.caption ?? 'Runs as you, in one transaction')
            : said[standing]}
        </Box>
      </Typography>
      <Box component="pre" ref={pre} sx={code}>
        {drawn.map((piece, at) => (
          <Box
            component="span"
            // biome-ignore lint/suspicious/noArrayIndexKey: a run's place is its identity.
            key={at}
            data-fresh={piece.fresh || undefined}
            data-fault={piece.fault || undefined}
            data-refused={(piece.refused && !piece.fault) || undefined}
          >
            {piece.text}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** The tick of a committed change, drawn once along its stroke. */
const Ticked = () => (
  <Box
    component={Check}
    size={Number.parseFloat(layout.icon!)}
    strokeWidth={2.5}
    aria-hidden
    sx={{
      flex: 'none',
      '& path': { strokeDasharray: 24, strokeDashoffset: 0 },
      '@media (prefers-reduced-motion: no-preference)': {
        '& path': { animation: `tick ${motion.state} ${motion['ease-out']} both` },
      },
      '@keyframes tick': { from: { strokeDashoffset: 24 } },
    }}
  />
)
const settling = {
  '@media (prefers-reduced-motion: no-preference)': {
    animation: `said ${motion.state} ${motion['ease-out']} both`,
  },
  '@keyframes said': { from: { opacity: 0, transform: `translateY(${tokens.layout.rise})` } },
}
const code = {
  m: 0,
  px: 3.5,
  py: 3,
  bgcolor: 'grey.100',
  color: colors['ink-raised'],
  ...tokens.typography.code,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  '& span': { borderRadius: rounded.xs, boxDecorationBreak: 'clone' },
  '& [data-refused]': { bgcolor: colors['danger-red-wash'] },
  '& [data-fault]': {
    bgcolor: colors['danger-red-wash'],
    color: colors['danger-red-ink'],
    textDecoration: `underline wavy ${colors['danger-red']}`,
    textDecorationThickness: tokens.layout.ring,
    textUnderlineOffset: tokens.layout.offset,
    textDecorationSkipInk: 'none',
  },
} as const
