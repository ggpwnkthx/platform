import type { Wanted } from '@platform/vocabulary'

/** The fields a privilege is limited to: each one may be taken out of it, or put back in. */
export function FieldMatrix({
  columns,
  listed,
  set,
  wanted,
}: {
  columns: string[]
  listed: string[]
  set: (privilege: string, next: Wanted) => void
  wanted: (privilege: string) => Wanted
}) {
  return (
    <div class="grid-wrap">
      <table class="grid grid-tight">
        <thead>
          <tr>
            <th>Field</th>
            {listed.map((privilege) => {
              const chosen = wanted(privilege) as string[]
              const every = chosen.length === columns.length
              return (
                <th key={privilege} class="matrix-cell">
                  <span class="mono">{privilege}</span>
                  <button
                    type="button"
                    class="link-quiet"
                    onClick={() => set(privilege, every ? [] : [...columns])}
                  >
                    {every ? 'none' : 'all'}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column}>
              <td class="mono">{column}</td>
              {listed.map((privilege) => {
                const chosen = wanted(privilege) as string[]
                return (
                  <td key={privilege} class="matrix-cell">
                    <input
                      type="checkbox"
                      aria-label={`${privilege} on ${column}`}
                      checked={chosen.includes(column)}
                      onChange={(e) =>
                        set(
                          privilege,
                          e.currentTarget.checked
                            ? [...chosen, column]
                            : chosen.filter((name) => name !== column)
                        )
                      }
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
