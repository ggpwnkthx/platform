import {
  catalog as readCatalog,
  identity as readIdentity,
  indexPresentations,
  presentations as readPresentations,
  versionMismatch,
  VERSION,
} from '@platform/core'
import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { defaultRuntimeConfig, type RuntimeConfig } from '../config.ts'
import type { Session } from '../connect.ts'
import type { Installation } from './types.ts'

/** What the reader is and what they may reach, read as themselves. */
export async function readInstallation(db: Session): Promise<Installation> {
  const identity = await readIdentity(db)
  const mismatch = versionMismatch(identity.platform_version)
  if (mismatch)
    throw new Error(
      mismatch === 'older'
        ? `This database is at version ${identity.platform_version}; the interface is ${VERSION}. Run \`bun run cli migrate\`.`
        : `This database is at version ${identity.platform_version}, newer than this interface (${VERSION}). Publish the matching interface.`
    )
  return {
    identity,
    catalog: await readCatalog(db),
    presentations: indexPresentations(await readPresentations(db)),
  }
}

export const loadConfig = async (): Promise<RuntimeConfig> => {
  const response = await fetch('/config.json', { cache: 'no-store' })
  if (!response.ok) throw new Error('The interface has no configuration: config.json is missing.')
  const config = { ...defaultRuntimeConfig, ...(await response.json()) } as RuntimeConfig
  // A path is resolved against the page; ws:// on an http page and wss:// on an https one.
  const relay = new URL(config.relay, location.href)
  if (!/^wss?:$/.test(relay.protocol))
    relay.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return { ...config, issuer: config.issuer.replace(/\/+$/, ''), relay: relay.toString() }
}
/** The token lives in memory only, so a page load always starts signed out. */
export const issuer = (config: RuntimeConfig) =>
  new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: `${location.origin}/`,
    scope: 'openid email',
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  })
