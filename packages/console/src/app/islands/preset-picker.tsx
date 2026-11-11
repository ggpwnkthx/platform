/**
 * The preset of a provider: the catalog of the platform, and the form
 * that fills the registration with it.
 *
 * The preset is a table of defaults: the issuer, the scopes and the
 * algorithms of the provider, and the steps of the registration of the
 * client of Access at the vendor. The operator picks one, and the fields
 * that are empty are filled with it; every field stays the operator's.
 */

import { useState } from 'hono/jsx'
import type { CatalogEntry } from '../../domains/access'

export default function PresetPicker(props: { catalog: readonly CatalogEntry[] }) {
  const [key, setKey] = useState('')
  const entry = props.catalog.find((candidate) => candidate.key === key)

  /** Fills the fields of the form that are empty. */
  const fill = (preset: CatalogEntry | undefined): void => {
    if (!preset) return
    const form = document.querySelector('form[data-provider]') as HTMLFormElement | null
    if (!form) return
    const issuer = form.elements.namedItem('issuer') as HTMLInputElement | null
    const scopes = form.elements.namedItem('idpScopes') as HTMLInputElement | null
    const slug = form.elements.namedItem('slug') as HTMLInputElement | null
    if (issuer && issuer.value.trim() === '') issuer.value = preset.issuer
    if (scopes && scopes.value.trim() === '') scopes.value = preset.scopes.join(', ')
    if (slug && slug.value.trim() === '') slug.value = preset.slug
  }

  return (
    <label class="field">
      <span>Preset</span>
      <select
        name="preset"
        value={key}
        onChange={(event: Event) => {
          const value = (event.target as HTMLSelectElement).value
          setKey(value)
          fill(props.catalog.find((candidate) => candidate.key === value))
        }}
      >
        <option value="">the provider of the tenant, registered by hand</option>
        {props.catalog.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {candidate.displayName}
          </option>
        ))}
      </select>
      <span class="hint">
        the preset fills the issuer, the scopes and the algorithms of the provider; every field
        stays yours
      </span>
      {entry ? (
        <span class="stack" style="gap: 0.3rem">
          {entry.steps.map((step) => (
            <span key={step} class="hint">
              {step}
            </span>
          ))}
        </span>
      ) : null}
    </label>
  )
}
