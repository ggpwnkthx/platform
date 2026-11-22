import type { Choice } from '../../terminal.ts'
import { examplesIn } from './site.ts'
import { ROOT } from '../runtime.ts'

/**
 * The sites that are offered: the examples the checkout carries, and the platform's own
 * interface, which is no folder's. Any other folder is named in the configuration itself,
 * PLATFORM_SITE, and is then not asked for.
 */
export function siteChoices(): Choice[] {
  return [
    ...examplesIn(ROOT).map((name) => ({
      value: `examples/${name}`,
      label: name,
      hint: `examples/${name}`,
    })),
    { value: '', label: 'None', hint: "the platform's own interface" },
  ]
}
