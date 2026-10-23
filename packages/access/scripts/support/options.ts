/**
 * The options of the command line of a script of the operator.
 *
 * A script of the operator is run by a pipeline and by a human: the
 * options are read the same way in both cases.
 */

/**
 * Reads an option of the command line: `--name=value` or `--name value`.
 *
 * An option that is not given is not given: the script reads its own
 * default, and the default of the script is the one of the measurement
 * or of the plan.
 */
export function readOption(name: string): string | undefined {
  const flag = `--${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(flag))
  if (inline) return inline.slice(flag.length)
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return process.argv[index + 1]
}
