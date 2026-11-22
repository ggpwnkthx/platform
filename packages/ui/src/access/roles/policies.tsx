import type { PolicyInfo } from '@platform/data'
import { PolicyCard } from '../policies/card.tsx'

/**
 * The row policies that apply to a role, wherever it is read: by its name, through a group
 * it inherits from, or as PUBLIC. Where row security is on, these decide which rows it
 * reaches.
 */
export function AppliedPolicies({ policies, name }: { policies: PolicyInfo[]; name: string }) {
  return (
    <section class="section">
      <header class="section-head">
        <div>
          <h2>Row policies that apply to it</h2>
          <p>
            By its name, through a group it inherits from, or as PUBLIC, in every workspace you may
            see. Where row security is on, these decide which rows {name} reaches.
          </p>
        </div>
      </header>
      {policies.length ? (
        <ul class="policies">
          {policies.map((p) => (
            <PolicyCard key={`${p.schema}.${p.table}.${p.name}`} policy={p} place />
          ))}
        </ul>
      ) : (
        <p class="panel-note">No policy you may see applies to this role.</p>
      )}
    </section>
  )
}
