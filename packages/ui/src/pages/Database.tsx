import { KindTable } from '../kit/Kinds.tsx'
import { Page } from '../kit/Page.tsx'
import { sessions, tableStats } from './database-kinds.tsx'
import { extensions } from './extensions.tsx'

/** The database as a whole, as the reader may see it: what is installed, who is connected, what is large. */
export const Database = () => (
  <Page title="The database" crumb="Database">
    <KindTable kind={sessions} where={{}} />
    <KindTable kind={tableStats} where={{}} />
    <KindTable kind={extensions} where={{}} />
  </Page>
)
