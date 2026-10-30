/**
 * The confirmation of a reader.
 *
 * A command that changes something asks the reader before it changes
 * it, and the question is refused when there is nobody to answer: a
 * command that waits for a key in a pipeline waits forever.
 */

import { CliFailure } from '../domains/failure'

/**
 * Asks the operator a question and waits for the answer.
 *
 * A question with choices is answered with one of them: the operator
 * types the number of the choice or the name of it. A question without
 * choices is answered with what the operator typed, and an empty answer
 * takes the default of the question.
 *
 * A question that nobody can answer is refused: a command that waits
 * for an answer in a pipeline waits forever.
 *
 * @param question the question the operator is asked.
 * @param choices the choices of the question, when it has any.
 * @param input the stream the question is asked on.
 * @param output the stream the answer is written on.
 */
export async function ask(
  question: string,
  choices?: readonly string[],
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout
): Promise<string> {
  if (!input.isTTY) {
    throw new CliFailure(
      'the command asks a question and nobody can answer it: run it on a terminal',
      2,
      'not_answered'
    )
  }
  const { createInterface } = await import('node:readline')
  const reader = createInterface({ input, output })
  try {
    if (choices && choices.length > 0) {
      const numbered = choices.map((choice, index) => `  [${index + 1}] ${choice}`).join('\n')
      const answer = await new Promise<string>((resolve) => {
        reader.question(`${question}\n${numbered}\n> `, resolve)
      })
      const trimmed = answer.trim()
      const index = Number.parseInt(trimmed, 10)
      if (Number.isFinite(index) && index >= 1 && index <= choices.length) {
        return choices[index - 1]!
      }
      const chosen = choices.find((choice) => choice === trimmed)
      if (chosen !== undefined) return chosen
      throw new CliFailure(`the answer "${trimmed}" is not one of the choices`, 2, 'not_answered')
    }
    const answer = await new Promise<string>((resolve) => {
      reader.question(`${question} `, resolve)
    })
    return answer.trim()
  } finally {
    reader.close()
  }
}

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
