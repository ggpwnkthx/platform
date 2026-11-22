import { useRef } from 'preact/hooks'

/**
 * The two things every drawer asks for: a key that changes when it is opened, and what it
 * was last opened on.
 */

/**
 * A key that changes each time something opens and stays while it closes, so that an editor
 * starts from what the database holds every time it is opened.
 */
export function useOpening(open: boolean): number {
  const opened = useRef(0)
  const was = useRef(false)
  if (open && !was.current) opened.current += 1
  was.current = open
  return opened.current
}

/** What was last asked for, kept while the drawer that shows it closes. */
export function useLast<T>(value: T | null): T | null {
  const last = useRef<T | null>(value)
  if (value !== null) last.current = value
  return last.current
}
