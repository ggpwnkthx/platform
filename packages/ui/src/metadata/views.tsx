import { Group, SegmentedControl, Text } from '@mantine/core'
import {
  type ViewMode,
  customModes,
  isCustomView,
  situationModes,
  situations,
} from '@platform/core'
import { Remove } from '../bits/page.tsx'
import { modeWords, situationWords } from './shared.ts'

/** Where a field appears: in the records grid, in the record form, in the filter builder. */
export function ViewModes({
  views,
  computed,
  onChange,
}: {
  views: Record<string, ViewMode | undefined>
  computed: boolean
  onChange(views: Record<string, ViewMode | undefined>): void
}) {
  return (
    <>
      {situations.map((situation) => (
        <Group key={situation} justify="space-between">
          <Text fz="sm">{situationWords[situation]}</Text>
          {computed && situation === 'record' ? (
            <Text fz="sm" c="dimmed">
              Shown and locked: PostgreSQL computes it
            </Text>
          ) : (
            <SegmentedControl
              size="xs"
              data={situationModes[situation].map((mode) => ({
                value: mode,
                label: modeWords[mode],
              }))}
              value={views[situation]}
              onChange={(mode) => onChange({ ...views, [situation]: mode as ViewMode })}
            />
          )}
        </Group>
      ))}
    </>
  )
}

/** A view of the owner's own: shown, hidden, or shown and locked — and forgotten. */
export function CustomViews({
  views,
  onChange,
}: {
  views: Record<string, ViewMode | undefined>
  onChange(views: Record<string, ViewMode | undefined>): void
}) {
  return (
    <>
      {Object.keys(views)
        .filter(isCustomView)
        .map((view) => (
          <Group key={view} justify="space-between">
            <Text fz="sm" className="mono">
              {view}
            </Text>
            <Group gap="xs">
              <SegmentedControl
                size="xs"
                data={customModes.map((mode) => ({ value: mode, label: modeWords[mode] }))}
                value={views[view]}
                onChange={(mode) => onChange({ ...views, [view]: mode as ViewMode })}
              />
              <Remove
                label={`Forget the view ${view}`}
                onClick={() =>
                  onChange(Object.fromEntries(Object.entries(views).filter(([k]) => k !== view)))
                }
              />
            </Group>
          </Group>
        ))}
    </>
  )
}
