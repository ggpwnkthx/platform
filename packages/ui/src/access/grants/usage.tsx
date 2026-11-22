import { Checkbox } from '../../ui/form.tsx'
import { Notice } from '../../ui/bits.tsx'

/** A role that may not use the workspace: what the database refuses, and what may be done. */
export function UsageNotice({
  grantee,
  mayGrantUsage,
  owner,
  schema,
  setWithUsage,
  withUsage,
}: {
  grantee: string
  mayGrantUsage: boolean
  /** The owner of the workspace: it is the one that may grant the usage. */
  owner: string | undefined
  schema: string
  setWithUsage: (on: boolean) => void
  withUsage: boolean
}) {
  return (
    <Notice tone="warning" title={`${grantee} may not use ${schema} yet`}>
      {mayGrantUsage ? (
        <>
          Without USAGE on the workspace the database refuses every statement on a collection
          inside, whatever is granted here.
          <Checkbox
            checked={withUsage}
            onChange={setWithUsage}
            label={`Grant USAGE on ${schema} too`}
          />
        </>
      ) : (
        <>
          Without USAGE on the workspace the database refuses every statement on a collection
          inside. Its owner, {owner}, grants it.
        </>
      )}
    </Notice>
  )
}
