import type { DeployRuntime } from '../runtime.ts'
import { saved } from '../runtime.ts'
import { settingsKubernetes } from './settings-kubernetes.ts'
import { settingsLocal } from './settings-local.ts'
import type { Setting } from './setting.ts'

/**
 * The values that follow from the pieces: they are worked out here, once, and used both
 * when the configuration is written and when a command runs without writing one.
 */
export function computed(
  settings: Setting[],
  answers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const setting of settings.filter((s) => s.follows)) {
    const value = answers[setting.name] ?? setting.follows!(answers)
    if (value === undefined) continue
    answers[setting.name] = value
    out[setting.name] = value
  }
  return out
}

/**
 * The addresses a deployment is named by, worked out from the pieces it is made of. The
 * configuration holds the pieces; the addresses are made of them at runtime, and the
 * environment may override any of them.
 */
export function computedValues(target: 'local' | 'k8s', r: DeployRuntime): Record<string, string> {
  const settings = target === 'local' ? settingsLocal() : settingsKubernetes()
  const answers: Record<string, string> = {}
  for (const setting of settings) {
    // Bun loads the file into the environment: the same value in both is the file's own.
    const fromFile = saved(r.envFile, setting.name)
    const fromEnv = r.env[setting.name]
    // A computed value is never read from the file: it is made of the pieces it holds.
    if (fromEnv && fromEnv !== fromFile) answers[setting.name] = fromEnv
    else if (!setting.follows && fromFile) answers[setting.name] = fromFile
  }
  return computed(settings, answers)
}

/**
 * What a name is worth in this deployment: the environment's, unless it is only the file's
 * own value again — Bun loads the file into the environment, and the two are one value.
 */
export function settingValue(r: DeployRuntime, name: string): string | undefined {
  const fromFile = saved(r.envFile, name)
  const fromEnv = r.env[name]
  if (fromEnv && fromEnv !== fromFile) return fromEnv
  return fromFile
}
