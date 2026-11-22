import {
  catalog as readCatalog,
  type Catalog,
  identity as readIdentity,
  type Identity,
  indexPresentations,
  presentations as readPresentations,
  type PresentationIndex,
} from '@platform/data'
import { versionProblem } from '../version.ts'
import type { Db } from '../pg/connect.ts'

/** What the installation holds: who the reader is, what the database holds, and how it presents itself. */
export async function readInstallation(db: Db): Promise<{
  identity: Identity
  catalog: Catalog
  presentations: PresentationIndex
}> {
  // The identity first: it says which version the installation is, and the rest of the
  // platform's schema is that version's.
  const me = await readIdentity(db)
  const wrong = versionProblem(me.platform_version)
  if (wrong) throw new Error(wrong)
  const found = await readCatalog(db)
  const shown = await readPresentations(db)
  return { identity: me, catalog: found, presentations: indexPresentations(shown) }
}
