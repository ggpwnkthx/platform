import { useEffect, useState } from 'preact/hooks'

/** Statements for a draft, or the reason they cannot be written yet. */
export function usePreview(
  make: () => Promise<string[]>,
  deps: unknown[]
): { statements: string[]; error: string | null } {
  const [state, setState] = useState<{ statements: string[]; error: string | null }>({
    statements: [],
    error: null,
  })
  useEffect(() => {
    let live = true
    make()
      .then((statements) => live && setState({ statements, error: null }))
      .catch(
        (error) =>
          live &&
          setState({
            statements: [],
            error: error instanceof Error ? error.message : String(error),
          })
      )
    return () => {
      live = false
    }
  }, deps)
  return state
}
