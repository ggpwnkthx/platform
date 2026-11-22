import type { Kind } from '@platform/data'
import type { FieldRenderers, Situation } from '@platform/vocabulary'
import type { Draw } from '../field.ts'

export interface RendererOption {
  /** The name of the option, as the owner writes it. */
  name: string
  /** What the option is, in a sentence. */
  label: string
  /**
   * How the option is given. A text and a number are typed; an icon is picked from the
   * platform's own set and kept by its name, and a colour from its palette, by its family's.
   * Text when it is not said.
   */
  type?: 'text' | 'number' | 'icon' | 'colour'
  /** An example of the option, shown under it where it is typed. */
  placeholder?: string
}

/** One way of drawing a value. */
export interface Renderer {
  /** The name the owner says it by. */
  name: string
  /** What it draws, in a sentence. */
  label: string
  /** The kinds of value it draws; empty means any kind. */
  kinds: Kind[]
  /** The situations it draws in; empty means any situation. */
  situations: Situation[]
  /** The options it takes, if any. */
  options?: RendererOption[]
  /** Draws the value. */
  render: Draw
}

/** The renderers the platform holds, by name. */
const registry = new Map<string, Renderer>()

/**
 * Adds a renderer of the installation's own. A renderer is one way of drawing a value: it
 * is given the value and the situation it is drawn in, and it draws. It may be said of any
 * field by name, in any situation.
 */
export function registerRenderer(renderer: Renderer): void {
  registry.set(renderer.name, renderer)
}

/** The renderer of that name, if there is one. */
export function rendererNamed(name: string): Renderer | null {
  return registry.get(name) ?? null
}

/** Every renderer the platform holds, in the order they were added. */
export function knownRenderers(): Renderer[] {
  return [...registry.values()]
}

/** Does this renderer draw this kind of value in this situation? */
export function appliesTo(renderer: Renderer, kind: Kind, situation: Situation): boolean {
  if (renderer.kinds.length && !renderer.kinds.includes(kind)) return false
  if (renderer.situations.length && !renderer.situations.includes(situation)) return false
  return true
}

/** The renderers that may draw this kind of value in this situation. */
export function renderersFor(kind: Kind, situation: Situation): Renderer[] {
  return knownRenderers().filter((renderer) => appliesTo(renderer, kind, situation))
}

/**
 * The renderer that draws a value: the one the field says, when it is one that may draw it,
 * and the platform's own when it is not.
 */
export function resolveRenderer(
  kind: Kind,
  situation: Situation,
  saying: FieldRenderers | undefined
): Renderer {
  const choice = saying?.[situation]
  if (choice) {
    const renderer = rendererNamed(choice.renderer)
    if (renderer && appliesTo(renderer, kind, situation)) return renderer
  }
  return rendererNamed('default')!
}

/** A number the owner gave, or the one the renderer falls back to. */
/**
 * A value, drawn the way its field says it is drawn, in the situation it is drawn in.
 *
 * A value that is null is drawn as null, whatever the saying: there is nothing to draw.
 */
