import { useParams, useSearchParams } from 'react-router-dom'
import { revisions } from '../access/revisions.tsx'
import { useNames } from '../kit/place.ts'
import { Page } from '../kit/Page.tsx'
import { KindTable } from '../kit/Kinds.tsx'

/** What was done in the workspace in view: every write, from the interface or any client. */
export function Activity() {
  const { ws = '' } = useParams()
  const table = useSearchParams()[0].get('table') ?? undefined
  return (
    <Page title="Activity" crumb={useNames()(ws).name}>
      <KindTable kind={revisions} where={{ schema: ws, table }} />
    </Page>
  )
}
