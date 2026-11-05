/**
 * The confirmation of a reader.
 *
 * A command that changes something asks the reader before it changes
 * it, and the question is refused when there is nobody to answer: a
 * command that waits for a key in a pipeline waits forever.
 *
 * The dialog of a command is written on the standard error: the
 * standard output holds the answer of the command and nothing else, so
 * a script that reads the answer of a command reads the answer, and
 * the question of the command never sits in the middle of it.
 */

import { CliFailure } from '../domains/failure'

/**
 * The number of times a question is asked before it is refused.
 *
 * A reader who answers with something the deployment cannot use is
 * asked again: a reader who types the wrong answer is not a reader who
 * wants to stop, and a refusal after one mistyped character is a
 * refusal the reader did not earn.
 */
const ATTEMPTS = 3

/**
 * Asks the operator a question and waits for the answer.
 *
 * A question with choices is answered with one of them: the operator
 * types the number of the choice or the name of it. A question without
 * choices is answered with what the operator typed, and an empty answer
 * takes the default of the question.
 *
 * An answer that is not one of the choices is asked again: the reader
 * is told what the answer was, and the question is asked once more.
 * A question with choices and a default takes the default when the
 * reader answers nothing: the reader confirms the default by answering
 * nothing.
 *
 * A question that nobody can answer is refused: a command that waits
 * for an answer in a pipeline waits forever.
 *
 * @param question the question the operator is asked.
 * @param choices the choices of the question, when it has any.
 * @param input the stream the question is asked on.
 * @param output the stream the question is written on.
 * @param fallback the default of the question, when it has choices.
 */
export async function ask(
  question: string,
  choices?: readonly string[],
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
  fallback?: string
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
      let last = ''
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const answer = await new Promise<string>((resolve) => {
          reader.question(`${question}\n${numbered}\n> `, resolve)
        })
        const trimmed = answer.trim()
        last = trimmed
        // The reader answers nothing: the reader confirms the default
        // of the question, and the default is one of the choices.
        if (trimmed === '' && fallback !== undefined && choices.includes(fallback)) {
          return fallback
        }
        const index = Number.parseInt(trimmed, 10)
        if (Number.isFinite(index) && index >= 1 && index <= choices.length) {
          return choices[index - 1]!
        }
        const chosen = choices.find((choice) => choice === trimmed)
        if (chosen !== undefined) return chosen
        // The answer is not one of the choices: the reader is told so,
        // and the question is asked again.
        output.write(`"${trimmed}" is not one of the choices\n`)
      }
      throw new CliFailure(`the answer "${last}" is not one of the choices`, 2, 'not_answered')
    }
    const answer = await new Promise<string>((resolve) => {
      reader.question(`${question}\n> `, resolve)
    })
    return answer.trim()
  } finally {
    reader.close()
  }
}

/**
 * Asks the reader to confirm.
 *
 * The context is what the reader reads before it answers: the plan of
 * the deployment, for the command that applies it. A reader that
 * answers with the question of a plan it has not seen is a reader that
 * answers blind.
 *
 * The context is shown even when the reader asked for no question:
 * `--yes` answers the question with yes, and it does not hide the
 * plan the answer is about.
 *
 * The context and the question are written on the standard error, and
 * the answer of the command stays on the standard output.
 *
 * @param question the question the reader is asked.
 * @param confirmed true when the reader asked for no question.
 * @param input the stream the question is asked on.
 * @param output the stream the question is written on.
 * @param context the lines the reader reads before the question.
 * @param tell what the context is written with.
 */
export async function confirm(
  question: string,
  confirmed: boolean,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
  context: readonly string[] = [],
  tell: (text: string) => void = (text) => output.write(`${text}\n`)
): Promise<void> {
  for (const line of context) tell(line)
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
