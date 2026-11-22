import type { ComponentChildren } from 'preact'
import type { Filter } from '@platform/data'
import { Value } from '../../fields/renderers/renderers.tsx'
import type { Field } from '../../fields/field.ts'
import { plural } from '../../format.ts'
import { Checkbox } from '../../ui/form.tsx'
import { CloseIcon, RefreshIcon, SearchIcon } from '../../ui/icons.tsx'
import { conditionText } from './filter.tsx'

/**
 * The toolbar of the list: what the reader is searching for, the filters they have set, and
 * the fields of the platform they wish to see.
 */
export function RecordsToolbar({
  draft,
  setDraft,
  searchRef,
  readable,
  filter,
  readableFields,
  showSystem,
  setShowSystem,
  filterBuilder,
  onRemoveFilter,
  onReadAgain,
}: {
  draft: string
  setDraft: (text: string) => void
  searchRef: preact.RefObject<HTMLInputElement>
  /** How many fields the reader may read. */
  readable: number
  filter: Filter
  readableFields: Field[]
  showSystem: boolean
  setShowSystem: (on: boolean) => void
  /** The form that adds a filter, where the collection offers one. */
  filterBuilder: ComponentChildren
  onRemoveFilter: (column: string) => void
  onReadAgain: () => void
}) {
  return (
    <>
      <label class="search">
        <SearchIcon size={16} aria-hidden="true" />
        <span class="sr-only">Search</span>
        <input
          ref={searchRef}
          type="search"
          value={draft}
          onInput={(e) => setDraft(e.currentTarget.value)}
          placeholder={`Search ${plural(readable, 'readable field')}`}
        />
        <kbd>/</kbd>
      </label>
      {filterBuilder}
      {Object.entries(filter).map(([column, condition]) => (
        <span key={column} class="chip">
          <span class="mono">{column}</span>{' '}
          {conditionText(condition, (value) => {
            const field = readableFields.find((one) => one.name === column)
            if (!field) return String(value)
            return <Value value={value} field={field} situation="filter" />
          })}
          <button
            type="button"
            aria-label={`Remove the filter on ${column}`}
            onClick={() => onRemoveFilter(column)}
          >
            <CloseIcon size={14} />
          </button>
        </span>
      ))}
      <span class="toolbar-gap" />
      <Checkbox checked={showSystem} onChange={setShowSystem} label="System fields" />
      <button
        type="button"
        class="icon-button"
        aria-label="Read again"
        title="Read again"
        onClick={onReadAgain}
      >
        <RefreshIcon size={18} />
      </button>
    </>
  )
}
