import { useEffect, useRef, useState } from 'preact/hooks'

/**
 * What the reader has chosen of the page they are on: the records they picked, and the text
 * they are searching for. A new collection starts with nothing chosen.
 */
export function useChosen(rows: Record<string, unknown>[], ws: string, table: string) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => setSelected(new Set()), [ws, table])
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(String(r.id)))
  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelected(next)
  }
  const selectAll = (checked: boolean) =>
    setSelected(checked ? new Set(rows.map((r) => String(r.id))) : new Set())
  return { selected, allSelected, toggle, selectAll, setSelected }
}

/**
 * The search the reader is typing, and the one the list is reading: the second follows the
 * first, a moment after the last key.
 */
export function useSearchBox(search: string, onSearch: (text: string) => void) {
  const [draft, setDraft] = useState(search)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(search), [search])
  // Search as you type, after a short pause.
  useEffect(() => {
    if (draft === search) return
    const timer = setTimeout(() => onSearch(draft), 300)
    return () => clearTimeout(timer)
  }, [draft])
  // '/' focuses the search, as in most data tools.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault()
        ref.current?.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  return { draft, setDraft, ref }
}
