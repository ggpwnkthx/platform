/**
 * What nobody reads in a build's output: the identifiers of the layers and of the images,
 * and the word Podman has about the Compose provider it runs.
 */
export function noise(line: string): boolean {
  const text = line.trim()
  return (
    !text ||
    text.startsWith('-->') ||
    /^(sha256:)?[0-9a-f]{12,64}$/.test(text) ||
    text.startsWith('>>>> Executing external compose provider')
  )
}
/** A line of a build as it is shown: none for noise, and a step cut to the terminal's width. */
export function said(line: string): string | undefined {
  if (noise(line)) return undefined
  const text = line.trim()
  // Only a step is cut: it repeats the Dockerfile. An error is shown whole.
  const step = /^(\[\d+\/\d+\] STEP \d+\/\d+:|#\d+ \[)/.test(text)
  const width = Math.max(40, (process.stderr.columns ?? 80) - 8)
  return step && text.length > width ? `${text.slice(0, width - 1)}…` : text
}
/** Hands what a process says to a reader, a line at a time. A carriage return ends a line too. */
export async function lines(stream: ReadableStream<Uint8Array>, each: (line: string) => void) {
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of stream) {
    const parts = (rest + decoder.decode(chunk, { stream: true })).split(/\r?\n|\r/)
    rest = parts.pop() ?? ''
    for (const part of parts) if (part.trim()) each(part)
  }
  if (rest.trim()) each(rest)
}
