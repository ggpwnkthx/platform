import { useId } from 'preact/hooks'
import { useSession } from '../../session.tsx'
import { Avatar } from '../../ui/avatar.tsx'
import { Field, Input } from '../../ui/form.tsx'
import { CollectionIcon, WorkspaceIcon } from '../../ui/icons.tsx'
import { familyOf, parseColor } from '../color.ts'
import {
  colorKey,
  displayNameKey,
  iconKey,
  type MetadataChange,
  metadataStatements,
  type Presentation,
  presentationOf,
} from '@platform/data'
import { displayNameLimit } from '../labels.ts'
import type { MetadataTarget } from '@platform/vocabulary'
import { SaveStatements, useDraft } from './draft.tsx'
import { ColourPicker, IconPicker } from './pickers.tsx'

/** Are two presentations the same: the same name, the same icon and the same colour? */
const samePresentation = (one: Presentation, other: Presentation): boolean =>
  one.displayName === other.displayName && one.icon === other.icon && one.color === other.color

/**
 * How an item presents itself: the name people read, the icon they recognise and the colour
 * that marks it. Three reserved keys of the item's own metadata, so PostgreSQL's row security
 * decides who reads them and who changes them, as it does for every other key. A field is
 * presented by its name alone: a column is a label, not a mark.
 */
export function PresentationEditor({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const { presentations } = useSession()
  const stored = presentationOf(presentations, target.schema, target.table, target.column)
  const [draft, setDraft] = useDraft(stored, samePresentation)
  // What is typed, as it is typed: a name is trimmed, and an empty one removed, when saved.
  const name = draft.displayName ?? ''
  const icon = draft.icon ?? ''
  const colour = draft.color ?? ''
  const setName = (displayName: string) => setDraft({ ...draft, displayName })
  const setIcon = (icon: string) => setDraft({ ...draft, icon })
  const setColour = (color: string) => setDraft({ ...draft, color })
  const group = useId()
  const iconName = `${group}-icon`
  const colourName = `${group}-colour`
  const item = target.scope
  const Fallback = target.scope === 'workspace' ? WorkspaceIcon : CollectionIcon
  const marked = target.scope !== 'field'

  const changes: MetadataChange[] = []
  if (name.trim() !== (stored.displayName ?? ''))
    changes.push({ key: displayNameKey, value: name.trim() || null })
  if (marked && (icon || null) !== stored.icon) changes.push({ key: iconKey, value: icon || null })
  if (marked && (colour || null) !== stored.color)
    changes.push({ key: colorKey, value: colour || null })
  const statements = metadataStatements(target, changes)
  const chosen = familyOf(colour)
  const invalid = colour.trim() !== '' && !chosen && !parseColor(colour)

  return (
    <div class="presentation">
      <div class="presentation-preview">
        {marked && (
          <Avatar
            presentation={{ displayName: name.trim() || null, icon: icon || null, color: colour }}
            fallback={Fallback}
            class="avatar-preview"
            size={24}
          />
        )}
        <div>
          <strong>{name.trim() || (target.column ?? target.table ?? target.schema)}</strong>
          <small class="mono note">
            {target.column
              ? `${target.schema}.${target.table}.${target.column}`
              : target.table
                ? `${target.schema}.${target.table}`
                : target.schema}
            {name.trim() ? '' : ' · the name in SQL'}
          </small>
        </div>
      </div>
      <div class="form">
        <Field
          label="Display name"
          id={`${group}-name`}
          hint={`The name people read. The ${item} keeps its own name in SQL.`}
          error={name.length > displayNameLimit ? `${displayNameLimit} characters at most.` : null}
        >
          <Input
            id={`${group}-name`}
            value={name}
            disabled={!owner}
            maxLength={displayNameLimit + 20}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder={target.column ? 'Headline' : target.table ? 'Articles' : 'Newsroom'}
          />
        </Field>
        {marked && (
          <>
            <fieldset class="field field-wide types">
              <legend class="field-label">Icon</legend>
              <IconPicker
                name={iconName}
                value={icon}
                disabled={!owner}
                none={<Fallback size={18} />}
                noneTitle="The platform's own icon"
                onChoose={setIcon}
              />
              <p class="field-hint">
                The mark drawn beside the name. Without one, the platform's own.
              </p>
            </fieldset>
            <fieldset class="field field-wide types">
              <legend class="field-label">Primary colour</legend>
              <div class="colour-row">
                <ColourPicker
                  name={colourName}
                  chosen={chosen}
                  disabled={!owner}
                  onChoose={setColour}
                />
                <Input
                  class="mono colour-input"
                  value={colour}
                  disabled={!owner}
                  maxLength={7}
                  spellcheck={false}
                  aria-label="Colour"
                  onInput={(e) => setColour(e.currentTarget.value)}
                  placeholder="steel"
                />
              </div>
              {invalid ? (
                <p class="field-error">
                  A colour is a family of the palette &mdash; steel, cyan, bronze &mdash; or a
                  colour of your own, written as #rrggbb.
                </p>
              ) : (
                <p class="field-hint">
                  The colour of the mark. The studio draws its own palette: a colour of your own is
                  drawn as the family nearest to it, with the ink that reads on it.
                </p>
              )}
            </fieldset>
          </>
        )}
      </div>
      {owner && (
        <SaveStatements
          statements={statements}
          label="Save presentation"
          saved="Presentation saved"
          disabled={invalid}
        />
      )}
    </div>
  )
}
