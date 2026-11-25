/**
 * What changed in a statement since the reader last saw it, token by token: the words the
 * form just wrote are the ones the figure lights. Pure, so the figure only draws.
 */
export interface Piece {
  text: string
  /** Written by the last change of the form. */
  fresh: boolean
  /** Where PostgreSQL's refusal points. */
  fault: boolean
  /** The statement this belongs to; -1 for the line break between two. */
  statement: number
  /** Whether that statement is the one PostgreSQL refused. */
  refused: boolean
}
export interface Fault {
  statement: number
  /** PostgreSQL's 1-based character position within that statement, when it gave one. */
  position?: number
  /** Without a position, the name its message quotes: marked only where it appears once. */
  named?: string
}

const TOKEN =
  /\s+|"(?:[^"]|"")*"?|'(?:[^']|'')*'?|[\p{L}_][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|::|<>|[<>!]=|./gsu
type Token = { text: string; statement: number; at: number }

function tokens(sql: string[]): Token[] {
  return sql.flatMap((one, statement) => [
    ...(statement ? [{ text: '\n', statement: -1, at: 0 }] : []),
    ...[...one.matchAll(TOKEN)].map((m) => ({ text: m[0], statement, at: m.index })),
  ])
}

/** The tokens of `next` that are not in the longest common run with `last`. */
function freshOf(last: Token[], next: Token[]): boolean[] {
  const n = last.length
  const m = next.length
  // A change that rewrites a long script lights nothing rather than stall the form.
  if (!n || n * m > 400_000) return next.map(() => false)
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        last[i]!.text === next[j]!.text
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const fresh = next.map(() => true)
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (last[i]!.text === next[j]!.text) {
      fresh[j] = false
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++
    else j++
  }
  // Whitespace is lit exactly between two lit words, so a highlight is one run and never ends blank.
  return fresh.map((lit, j) =>
    /^\s+$/.test(next[j]!.text) ? !!fresh[j - 1] && !!fresh[j + 1] : lit
  )
}

/** The statement as runs of text that share their marks, ready to draw. */
export function pieces(last: string[], sql: string[], fault?: Fault | null): Piece[] {
  const next = tokens(sql)
  const fresh = freshOf(tokens(last), next)
  const named = fault?.named?.toLowerCase()
  const naming = (token: Token) =>
    token.statement === fault?.statement &&
    (token.text.toLowerCase() === named || token.text === `"${fault.named}"`)
  const at = fault?.position
    ? fault.position - 1
    : next.filter(naming).length === 1
      ? next.find(naming)!.at
      : -1
  const out: Piece[] = []
  next.forEach((token, j) => {
    const marked = !!fault && token.statement === fault.statement
    const faulty =
      marked && at >= token.at && at < token.at + token.text.length && !/^\s+$/.test(token.text)
    // Which statement was refused is worth marking only among several.
    const refused = marked && sql.length > 1
    const piece = { fresh: fresh[j]!, fault: faulty, statement: token.statement, refused }
    const prev = out.at(-1)
    if (
      prev &&
      prev.fresh === piece.fresh &&
      prev.fault === piece.fault &&
      prev.statement === piece.statement &&
      !faulty
    )
      prev.text += token.text
    else out.push({ text: token.text, ...piece })
  })
  return out
}
