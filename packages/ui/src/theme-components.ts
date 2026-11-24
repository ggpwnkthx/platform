import type { ThemeOptions } from '@mui/material/styles'
import tokens from 'virtual:design-tokens'
import { formColumn, hairline, inkOnWash, mono, px, statuses, type } from './theme.ts'

/**
 * How Material UI's and react-admin's own components are drawn: every one of them from the
 * tokens, so a page that uses a component gets the studio's, and cannot get another.
 */
const { colors: c, rounded, shadows, layout, components: parts } = tokens
export const components = (): ThemeOptions['components'] => ({
  MuiCssBaseline: {
    styleOverrides: {
      body: { fontFeatureSettings: '"cv11", "ss01"' },
      'code, pre, .mono': mono,
    },
  },
  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: { minHeight: layout.control, paddingInline: tokens.spacing.sm },
    },
    variants: [
      {
        props: { variant: 'contained', color: 'primary' },
        style: { boxShadow: shadows.rest, '&:hover': { boxShadow: shadows.glow } },
      },
      {
        props: { variant: 'outlined' },
        style: { borderColor: c.hairline, color: c['studio-black'] },
      },
      // An action without a ground is the orange's dark step: its bright step is not text.
      { props: { variant: 'text', color: 'primary' }, style: { color: c['studio-orange-ink'] } },
    ],
  },
  MuiTextField: { defaultProps: { variant: 'outlined', size: 'small' } },
  MuiFormControl: { defaultProps: { variant: 'outlined', size: 'small' } },
  MuiSelect: { defaultProps: { variant: 'outlined', size: 'small' } },
  // A field's name stands above its input, always: it is read before the value, and it never
  // moves. The outline is whole, with no notch cut for a label that floats.
  MuiInputLabel: {
    defaultProps: { shrink: true },
    styleOverrides: {
      root: ({ theme }) => ({
        position: 'static',
        transform: 'none',
        maxWidth: '100%',
        marginBottom: theme.spacing(1.5),
        ...type('label'),
        color: c['studio-black'],
      }),
    },
  },
  MuiOutlinedInput: {
    defaultProps: { notched: false },
    styleOverrides: {
      root: { ...type('body-small'), backgroundColor: c.paper },
      notchedOutline: { top: 0, borderColor: c.hairline, '& legend': { display: 'none' } },
    },
  },
  MuiPaper: {
    defaultProps: { elevation: 0 },
    styleOverrides: { rounded: { borderRadius: px(rounded.md!) } },
  },
  MuiCard: { styleOverrides: { root: { border: hairline, boxShadow: 'none' } } },
  MuiDrawer: {
    styleOverrides: { paper: { borderRadius: 0, boxShadow: shadows.float } },
  },
  MuiMenu: { styleOverrides: { paper: { boxShadow: shadows.float, border: hairline } } },
  MuiPopover: { styleOverrides: { paper: { boxShadow: shadows.float, border: hairline } } },
  MuiAutocomplete: { styleOverrides: { paper: { boxShadow: shadows.float, border: hairline } } },
  MuiTableCell: {
    styleOverrides: {
      root: { borderColor: c.hairline, padding: parts['table-cell']!.padding, ...type('body') },
      head: { ...type('label'), color: c['muted-text'], backgroundColor: c['subdued-grey'] },
    },
  },
  MuiTableRow: { styleOverrides: { root: { height: layout.row } } },
  MuiChip: {
    defaultProps: { size: 'small' },
    styleOverrides: {
      root: {
        ...type('badge'),
        borderRadius: px(rounded.pill!),
        ...{ backgroundColor: c['subdued-grey'], color: c['soft-text'] },
      },
    },
    variants: statuses.map((color) => ({ props: { color }, style: inkOnWash(color) })),
  },
  MuiAlert: {
    styleOverrides: {
      root: { border: 'none', alignItems: 'center' },
    },
    variants: (['info', 'success', 'warning', 'error'] as const).map((severity) => ({
      props: { severity },
      style: inkOnWash(severity),
    })),
  },
  MuiSnackbarContent: {
    styleOverrides: {
      root: { backgroundColor: c['ink-raised'], color: c.paper, boxShadow: shadows.float },
    },
  },
  // A page's sections, switched from its header: secondary buttons joined, the one in view on
  // the orange's light ground, as the navigation pane marks where the reader is.
  MuiToggleButton: {
    styleOverrides: {
      root: {
        ...type('control'),
        textTransform: 'none',
        height: layout.control,
        paddingBlock: 0,
        paddingInline: tokens.spacing.sm,
        color: c['soft-text'],
        borderColor: c.hairline,
        backgroundColor: c.paper,
        '&:hover': { backgroundColor: c['subdued-grey'] },
        '&.Mui-selected, &.Mui-selected:hover': {
          backgroundColor: c['orange-wash'],
          color: c['studio-orange-ink'],
        },
      },
    },
  },
  MuiToggleButtonGroup: {
    styleOverrides: { root: { borderRadius: px(rounded.sm!) } },
  },
  MuiTooltip: {
    styleOverrides: { tooltip: { backgroundColor: c['ink-raised'], ...type('body-small') } },
  },
  MuiLink: {
    styleOverrides: {
      root: { color: c['studio-orange-ink'], textDecorationColor: c['orange-wash-deep'] },
    },
  },
  // react-admin's own views, held to the frame: the table scrolls inside the page, never the page.
  ...({
    RaList: {
      styleOverrides: {
        root: {
          '& .RaList-main': { minWidth: 0 },
          '& .RaList-content': { boxShadow: 'none', minWidth: 0 },
        },
      },
    },
    RaReferenceField: {
      styleOverrides: {
        root: { '& .RaReferenceField-link > *': { color: c['studio-orange-ink'] } },
      },
    },
    // What may be done to the chosen rows is said over the table's heading, inside its card.
    RaBulkActionsToolbar: {
      styleOverrides: {
        root: {
          '& .RaBulkActionsToolbar-toolbar': {
            transform: 'none',
            minHeight: layout.row,
            height: layout.row,
            borderRadius: 0,
            backgroundColor: c['orange-wash'],
            color: c['studio-black'],
          },
          '& .RaBulkActionsToolbar-collapsed': { minHeight: 0, height: 0 },
        },
      },
    },
    // A value that is shown and not asked for is named as an input is.
    RaLabeled: {
      styleOverrides: {
        root: { '& .RaLabeled-label': { ...type('label'), color: c['studio-black'] } },
      },
    },
    RaFilterForm: { styleOverrides: { root: { alignItems: 'center', minHeight: 0 } } },
    RaTopToolbar: { styleOverrides: { root: { alignItems: 'center', gap: tokens.spacing.sm } } },
    // A form is one column of inputs, each as wide as the form, a step apart.
    RaSimpleForm: {
      styleOverrides: { root: { padding: 0, maxWidth: layout.form, ...formColumn } },
    },
  } as object),
  MuiListItemButton: {
    styleOverrides: {
      root: {
        padding: parts['nav-item']!.padding,
        color: c['soft-text'],
        '&.Mui-selected, &.Mui-selected:hover': {
          backgroundColor: c['orange-wash'],
          color: c['studio-orange-ink'],
        },
      },
    },
  },
})
