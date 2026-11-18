import clsx from 'clsx'
import type { LucideIcon } from 'lucide-preact'
import { toneClass } from '../state/color.ts'
import type { Presentation } from '../state/presentation.ts'
import { iconFor } from './icons.tsx'

/**
 * An item's mark: its icon on its colour. The colour is the owner's own data, resolved to
 * the palette family it belongs to; without one the mark keeps the ground its place gives it.
 */
export function Avatar({
  presentation,
  fallback,
  class: extra,
  size = 18,
}: {
  presentation?: Presentation | null
  /** The icon the item is drawn with when it names none of its own. */
  fallback: LucideIcon
  class?: string
  /** The glyph's size in pixels. */
  size?: number
}) {
  const Icon = iconFor(presentation?.icon) ?? fallback
  return (
    <span
      class={clsx('avatar', toneClass(presentation?.color), extra as string)}
      aria-hidden="true"
    >
      <Icon size={size} />
    </span>
  )
}
