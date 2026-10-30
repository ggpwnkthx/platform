/**
 * The running of a program.
 *
 * The CLI runs two programs of the machine of the operator: the tool
 * that writes the infrastructure, and the client of the provider of the
 * deployment. Both answer with words and with a status, and neither of
 * them is a service of the platform: the CLI speaks to them the way it
 * speaks to a program, and not over HTTP.
 */

import { spawn } from 'node:child_process'

/** The answer of a run of a program. */
export interface Answer {
  /** What the program wrote on its standard output. */
  readonly stdout: string
  /** What the program wrote on its standard error. */
  readonly stderr: string
  /** The status the program ended with. */
  readonly status: number
}

/** The options of a run. */
export interface RunOptions {
  /** The directory the program runs in. */
  readonly cwd?: string
  /** The environment of the program. It replaces the environment of the process. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** True when the program writes to the terminal of the reader. */
  readonly inherit?: boolean
}

/**
 * Runs a program and waits for it.
 *
 * A program that cannot be run at all is an error of the run and not a
 * status of the program: the caller decides what that means.
 *
 * @param program the path of the program.
 * @param args the words of the program.
 * @param options the options of the run.
 */
export async function run(
  program: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<Answer> {
  const environment: Record<string, string> = {}
  const source = options.env ?? process.env
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    environment[name] = value
  }
  return await new Promise<Answer>((resolve, reject) => {
    const child = spawn(program, [...args], {
      cwd: options.cwd,
      env: environment,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', (error: Error) => reject(error))
    child.on('close', (status: number | null) => {
      resolve({ stdout, stderr, status: status ?? 1 })
    })
  })
}
