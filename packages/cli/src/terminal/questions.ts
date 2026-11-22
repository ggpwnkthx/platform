import { confirm as clackConfirm, select, text } from '@clack/prompts'
import { answered, common } from './run.ts'
import type { Choice } from './types.ts'

/**
 * Asks for a line of text. An empty answer is the fallback, which is shown in the question's
 * place; an answer the check refuses is asked for again, with the problem under it.
 */
export async function ask(
  question: string,
  fallback: string,
  check?: (value: string) => string | undefined
): Promise<string> {
  const answer = answered(
    await text({
      ...common(),
      message: question,
      placeholder: fallback || undefined,
      defaultValue: fallback,
      validate: (value) => check?.(value?.trim() || fallback),
    })
  )
  return answer.trim() || fallback
}

/** Asks for one of a few answers. */
export async function choose(
  question: string,
  choices: Choice[],
  fallback: string
): Promise<string> {
  return answered(
    await select({ ...common(), message: question, options: choices, initialValue: fallback })
  )
}

/** Asks a question whose answer is yes or no. The fallback is the answer Enter alone gives. */
export async function confirm(question: string, fallback = false): Promise<boolean> {
  return answered(await clackConfirm({ ...common(), message: question, initialValue: fallback }))
}
