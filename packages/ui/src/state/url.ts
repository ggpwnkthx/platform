/** The address carries the context: the workspace, the collection and the record in view. */
export interface Place {
  ws?: string
  c?: string
  id?: string
  r?: string
  [key: string]: string | undefined
}

export function href(path: string, place: Place = {}): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(place)) if (value) query.set(key, value)
  const text = query.toString()
  return text ? `${path}?${text}` : path
}
