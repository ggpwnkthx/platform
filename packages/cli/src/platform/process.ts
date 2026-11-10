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
  /** True when the words of the program are shown as they come. */
  readonly stream?: boolean
  /**
   * The time the program may take, in milliseconds.
   *
   * A program that waits for something that never comes — the records
   * of DNS of a name that nobody delegated — waits forever, and a
   * deployment that waits forever is a deployment that is hung. The
   * program is stopped when the time is up, and the answer says that
   * it did not answer in time.
   */
  readonly timeoutMs?: number
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
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = (): void => {
      stopped = true
      stderr += `\nthe program did not answer in ${options.timeoutMs} milliseconds and was stopped\n`
      child.kill('SIGKILL')
      // The program may hold its pipes open with a program of its own,
      // and the answer of a program that was stopped does not wait for
      // them: the pipes are closed here.
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve({ stdout, stderr, status: 124 })
    }
    if (options.timeoutMs !== undefined) timer = setTimeout(stop, options.timeoutMs)
    child.stdout?.on('error', () => {})
    child.stderr?.on('error', () => {})
    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk)
      stdout += text
      if (options.stream) process.stderr.write(text)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk)
      stderr += text
      if (options.stream) process.stderr.write(text)
    })
    child.on('error', (error: Error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on('close', (status: number | null) => {
      if (timer) clearTimeout(timer)
      if (stopped) return
      resolve({ stdout, stderr, status: status ?? 1 })
    })
  })
}
