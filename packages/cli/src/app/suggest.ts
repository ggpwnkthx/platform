/**
 * The suggestion of the CLI.
 *
 * A reader who types a word that names nothing meant a word that names
 * something. The CLI finds the name that is the closest to the word
 * that was typed, and offers it: a refusal that names nothing leaves
 * the reader to guess what to type next.
 */

/**
 * The distance between two words.
 *
 * The distance is the number of edits that turn one word into the
 * other: an insertion, a deletion, or a substitution of one letter.
 *
 * @param left the first word.
 * @param right the second word.
 */
export function distanceOf(left: string, right: string): number {
  const rows = left.length + 1
  const columns = right.length + 1
  const table: number[] = new Array(rows * columns).fill(0)
  for (let row = 0; row < rows; row += 1) table[row * columns] = row
  for (let column = 0; column < columns; column += 1) table[column] = column
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      table[row * columns + column] = Math.min(
        table[(row - 1) * columns + column]! + 1,
        table[row * columns + column - 1]! + 1,
        table[(row - 1) * columns + column - 1]! + cost
      )
    }
  }
  return table[rows * columns - 1]!
}

/**
 * The name that is the closest to the word of the reader.
 *
 * A name that begins with the word of the reader is the closest one:
 * the reader typed the beginning of it. A name that is near the word of
 * the reader is close enough to be worth naming. A name that is far
 * from it is not a suggestion, it is noise.
 *
 * @param word the word the reader typed.
 * @param candidates the names that are there.
 */
export function closestOf(word: string, candidates: readonly string[]): string | undefined {
  const needle = word.toLowerCase()
  if (needle === '') return undefined
  let closest: string | undefined
  let score = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const name = candidate.toLowerCase()
    if (name === needle) return undefined
    let distance: number
    if (name.startsWith(needle)) {
      distance = 1
    } else {
      distance = distanceOf(name, needle)
      const limit = needle.length <= 4 ? 1 : needle.length <= 6 ? 2 : needle.length <= 9 ? 3 : 4
      if (distance > limit) continue
    }
    if (distance < score) {
      closest = candidate
      score = distance
    }
  }
  return closest
}

/**
 * The names that begin with the words of the reader.
 *
 * The reader who types the beginning of a name wants the names that
 * begin with it: they are the ones the reader was reaching for.
 *
 * @param words the words of the reader.
 * @param candidates the names that are there.
 */
export function beginningOf(
  words: readonly string[],
  candidates: readonly string[]
): readonly string[] {
  const typed = words.join(' ').toLowerCase()
  if (typed === '') return []
  return candidates.filter((candidate) => candidate.toLowerCase().startsWith(typed))
}
