/**
 * The browser of the machine.
 *
 * The login of the CLI is a login of a person: it opens the page of the
 * provider, and the person signs in there. A machine that has no
 * browser is a machine that cannot sign in, and the CLI says so.
 */

import type { BrowserPort } from '../domains/contracts'
import { CliFailure } from '../domains/failure'

/** The commands that open a page, by the platform of the machine. */
const OPENERS: Record<string, string> = {
  darwin: 'open',
  win32: 'explorer.exe',
}

/**
 * The browser of the machine.
 *
 * @param platform the platform of the machine.
 */
export function browserOf(platform: string = process.platform): BrowserPort {
  return {
    /**
     * Opens an address in the browser of the machine.
     *
     * @param url the address to open.
     */
    async open(url: string): Promise<void> {
      const command = OPENERS[platform] ?? 'xdg-open'
      const { spawn } = await import('node:child_process')
      const child = spawn(command, [url], { stdio: 'ignore', detached: true })
      child.unref()
      await new Promise<void>((resolve) => {
        child.on('error', () => {
          throw new CliFailure(
            `the browser of the machine cannot be opened: open ${url} by hand`,
            3,
            'no_browser'
          )
        })
        child.on('spawn', () => resolve())
      })
    },
  }
}
