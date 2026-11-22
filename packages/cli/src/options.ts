import { parseArgs } from 'node:util'

/**
 * The options a command takes: a name, and whether it takes a value.
 *
 * The operator's commands are read by node's own parser, so that `--name=value`,
 * `--name value` and the flags that are there or are not are the same everywhere, and are
 * the same as in every other tool that speaks them.
 */
export type Option = { type: 'string' | 'boolean' }

/** What a command was told: the options it was given, and what was left over. */
export type Options<K extends Record<string, Option>> = {
  /** The options that were given, by name. A flag that was not given is false. */
  values: { [N in keyof K]: K[N] extends { type: 'boolean' } ? boolean : string | undefined }
  /** What is left: the files to apply, the arguments of another program. */
  rest: string[]
}

/**
 * The options a command was given, and what was left of the arguments.
 *
 * An option the command does not know is refused by name, and so is one that is given
 * twice: a command asked the same thing twice is a command in a mess. An option with no
 * value is refused too.
 *
 * What is left over is given back as it was written: the files a command applies, or the
 * arguments of another program (`logs` of a deployment, for instance, are kubectl's own).
 */
export function options<K extends Record<string, Option>>(
  args: string[],
  known: K,
  {
    unknown = 'refuse',
    positionals = 'refuse',
  }: { unknown?: 'refuse' | 'keep'; positionals?: 'refuse' | 'keep' } = {}
): Options<K> {
  // Every option is read as one that may be given more than once: an option given twice is
  // refused here, and not read as the last one.
  const config: Record<string, { type: 'string' | 'boolean'; multiple: true }> = {}
  for (const [name, option] of Object.entries(known))
    config[name] = { type: option.type, multiple: true }
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args,
      options: config,
      allowPositionals: true,
      strict: unknown === 'refuse',
      tokens: true as const,
    })
  } catch (error) {
    throw new Error(reason(error))
  }
  const values: Record<string, string | boolean> = {}
  for (const [name, option] of Object.entries(known)) {
    const given = parsed.values[name]
    const list = given === undefined ? [] : Array.isArray(given) ? given : [given]
    if (list.length > 1) throw new Error(`Repeated --${name}`)
    // A flag is there or is not: it is always said which.
    if (option.type === 'boolean') {
      values[name] = list.length > 0
      continue
    }
    if (!list.length) continue
    const value = list[0]!
    if (value === '') throw new Error(`--${name} needs a value`)
    values[name] = String(value)
  }
  const rest: string[] = []
  for (const token of parsed.tokens ?? []) {
    if (token.kind === 'positional') {
      if (positionals === 'keep') rest.push(token.value)
      continue
    }
    if (token.kind === 'option-terminator') continue
    // An option the command does not know is passed on, as it was written.
    if (token.name in known) continue
    rest.push(
      token.rawName +
        (token.value === undefined ? '' : token.inlineValue ? `=${token.value}` : ` ${token.value}`)
    )
  }
  if (positionals === 'refuse' && parsed.positionals.length) unexpected(parsed.positionals)
  return { values: values as Options<K>['values'], rest }
}

/** Says what is not wanted: the arguments a command was given and has no use for. */
export function unexpected(arguments_: string[]): never {
  throw new Error(`Unexpected argument${arguments_.length > 1 ? 's' : ''}: ${arguments_.join(' ')}`)
}

/** What node's parser says, in the words the operator is used to. */
function reason(error: unknown): string {
  const code = (error as { code?: string }).code
  const message = (error as Error).message ?? String(error)
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const option = /Unknown option '([^']+)'/.exec(message)?.[1]
    return `Unknown option: ${option ?? message}`
  }
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    const option = /Option '(--[\w-]+)/.exec(message)?.[1]
    // A value that is missing, or one that looks like another option.
    if (/argument missing|is ambiguous/.test(message))
      return `${option ?? 'The option'} needs a value`
    // A flag that was given a value.
    if (/does not take an argument/.test(message)) return `${option ?? 'The option'} takes no value`
    return message
  }
  return message
}
