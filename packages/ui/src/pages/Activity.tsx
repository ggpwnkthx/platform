import { useParams, useSearchParams } from 'react-router-dom'
import { revisions } from '../access/revisions.tsx'
import { useNames } from '../kit/place.ts'
import { Page } from '../kit/Page.tsx'
import { KindTable } from '../kit/Kinds.tsx'

/** What was done in the schema in view: every write, from the interface or any client. */
export function Activity() {
  const { schema = '' } = useParams()
  const table = useSearchParams()[0].get('table') ?? undefined
  return (
    <Page title="Activity" crumb={useNames()(schema).name}>
      <KindTable kind={revisions} where={{ schema, table }} />
    </Page>
  )
}
