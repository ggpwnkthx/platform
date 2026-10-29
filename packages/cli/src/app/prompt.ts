/**
 * The confirmation of a reader.
 *
 * A command that changes something asks the reader before it changes
 * it, and the question is refused when there is nobody to answer: a
 * command that waits for a key in a pipeline waits forever.
 */

import { CliFailure } from '../domains/failure'

/**
 * Asks the reader to confirm.
 *
 * @param question the question the reader is asked.
 * @param confirmed true when the reader asked for no question.
 * @param input the stream the question is asked on.
 * @param output the stream the answer is written on.
 */
export async function confirm(
  question: string,
  confirmed: boolean,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout
): Promise<void> {
  if (confirmed) return
  if (!input.isTTY) {
    throw new CliFailure(
      'the command changes something and nobody can confirm it: pass --yes',
      2,
      'not_confirmed'
    )
  }
  const { createInterface } = await import('node:readline')
  const reader = createInterface({ input, output })
  try {
    const answer = await new Promise<string>((resolve) => {
      reader.question(`${question} [y/N] `, resolve)
    })
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new CliFailure('the command was not confirmed', 2, 'not_confirmed')
    }
  } finally {
    reader.close()
  }
}
