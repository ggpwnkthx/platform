import clsx from 'clsx'
import { useEffect, useState } from 'preact/hooks'
import { labelColumn, tableOf, type RelationInfo, relationOptions } from '@platform/data'
import { useSession } from '../session.tsx'
import { Input } from '../ui/form.tsx'
import { RelationIcon, SearchIcon } from '../ui/icons.tsx'
import { Menu } from '../ui/overlay.tsx'

/**
 * The input of a relation: a row of the collection the field points at, found by its name.
 * The rows offered are the ones the database lets this reader read; where it lets them read
 * none, the id is typed instead.
 */
export function RelationPicker({
  relation,
  value,
  onChange,
  disabled,
  id,
}: {
  /** The row the field points at: the collection the picker searches. */
  relation: RelationInfo
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  id: string
}) {
  const { catalog, withDb } = useSession()
  const target = tableOf(catalog, relation.target_schema, relation.target_table)
  const label = labelColumn(catalog, relation.target_schema, relation.target_table)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<{ id: string; label: string }[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  useEffect(() => {
    if (!value || !target?.can_select) {
      setCurrent(null)
      return
    }
    void withDb((db) =>
      relationOptions(db, relation.target_schema, relation.target_table, label, value)
    )
      .then((found) => setCurrent(found.find((o) => o.id === value)?.label ?? null))
      .catch(() => setCurrent(null))
  }, [value])
  useEffect(() => {
    if (!open || !target?.can_select) return
    const timer = setTimeout(() => {
      void withDb((db) =>
        relationOptions(db, relation.target_schema, relation.target_table, label, search)
      )
        .then(setOptions)
        .catch(() => setOptions([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [open, search])
  if (!target?.can_select)
    return (
      <Input
        id={id}
        mono
        value={value}
        disabled={disabled}
        placeholder={`id in ${relation.target_table} (you may not read it)`}
        onInput={(e) => onChange(e.currentTarget.value)}
      />
    )
  return (
    <div class="menu-anchor relation">
      <button
        id={id}
        type="button"
        class="input relation-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <RelationIcon size={16} aria-hidden="true" />
        {value ? (
          <span>
            {current ?? <span class="mono">{value}</span>}
            <small class="mono">{value.slice(0, 8)}</small>
          </span>
        ) : (
          <span class="placeholder">Choose a row of {relation.target_table}</span>
        )}
      </button>
      <Menu open={open} onClose={() => setOpen(false)} align="start">
        <label class="search search-menu">
          <SearchIcon size={16} aria-hidden="true" />
          <input
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            placeholder={`Search ${relation.target_table}`}
            aria-label={`Search ${relation.target_table}`}
          />
        </label>
        <div class="relation-options" role="listbox">
          {!options.length ? <p class="menu-note">Nothing found.</p> : null}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              class={clsx('menu-item', o.id === value && 'is-current')}
              onClick={() => {
                onChange(o.id)
                setOpen(false)
              }}
            >
              <span>{o.label}</span>
              <small class="mono">{o.id.slice(0, 8)}</small>
            </button>
          ))}
          {value && (
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              <span class="side-muted">Clear</span>
            </button>
          )}
        </div>
      </Menu>
    </div>
  )
}
