import { taskLog } from '@clack/prompts'
import { common } from './run.ts'
import type { Task, Tasks } from './types.ts'

/**
 * Something that talks while it works, such as a build: its last lines are shown while it
 * runs, and are taken away when it is done. When it fails, everything it said stays.
 */
export function task(label: string): Task {
  const shown = taskLog({ ...common(), title: label, limit: 8, retainLog: true })
  return {
    line: (message) => shown.message(message),
    done: (message) => shown.success(message),
    fail: (message) => shown.error(message, { showLog: true }),
  }
}

/**
 * Several of them at once, such as the builds of a stack's images: each part keeps its own
 * last lines under its name, and is a single line once it is done. When one fails,
 * everything that was said stays, under the part that said it.
 */
export function tasks(label: string): Tasks {
  const shown = taskLog({ ...common(), title: label, limit: 3, retainLog: true })
  return {
    part(name) {
      const part = shown.group(name)
      return {
        line: (message) => part.message(message),
        done: (message) => part.success(message),
        fail: (message) => part.error(message),
      }
    },
    done: (message) => shown.success(message),
    fail: (message) => shown.error(message, { showLog: true }),
  }
}
