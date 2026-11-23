import { ActionIcon, CheckIcon, ColorSwatch, Group, SimpleGrid } from '@mantine/core'
import { ItemIcon, itemIcons } from '../bits/marks.tsx'
import { palette } from '../bits/palette.ts'
export function IconPicker({ value, onChange }: { value: string; onChange(name: string): void }) {
  return (
    <SimpleGrid cols={10} spacing={4}>
      {itemIcons.map((name) => (
        <ActionIcon
          key={name}
          variant={value === name ? 'filled' : 'default'}
          title={name}
          aria-label={name}
          onClick={() => onChange(value === name ? '' : name)}
        >
          <ItemIcon name={name} />
        </ActionIcon>
      ))}
    </SimpleGrid>
  )
}
/** The palette's families: the reserved ones first, the studio's own five last. */
export function ColourPicker({ value, onChange }: { value: string; onChange(name: string): void }) {
  return (
    <Group gap={6}>
      {Object.entries(palette).map(([name, [fill]]) => (
        <ColorSwatch
          key={name}
          component="button"
          color={fill}
          title={name}
          aria-label={name}
          onClick={() => onChange(value === name ? '' : name)}
          style={{ cursor: 'pointer', color: '#fff' }}
        >
          {value === name && <CheckIcon size={12} />}
        </ColorSwatch>
      ))}
    </Group>
  )
}
