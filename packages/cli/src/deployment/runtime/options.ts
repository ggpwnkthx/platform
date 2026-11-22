export function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const at = args.findIndex((a) => a === `--${name}` || a.startsWith(prefix))
  if (at < 0) return undefined
  const arg = args.splice(at, 1)[0]!
  const value = arg.startsWith(prefix) ? arg.slice(prefix.length) : args.splice(at, 1)[0]
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`)
  if (args.some((a) => a === `--${name}` || a.startsWith(prefix)))
    throw new Error(`Repeated --${name}`)
  return value
}
export function seconds(value: string | undefined): number {
  const n = Number(value ?? 120)
  if (!Number.isInteger(n) || n < 1 || n > 1800) throw new Error('--timeout must be 1–1800 seconds')
  return n
}
export function noExtra(args: string[]) {
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(' ')}`)
}
