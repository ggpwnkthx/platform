import { Fragment } from 'preact'
import type { SchemaInfo } from '@platform/data'
import { isReservedKey } from '@platform/vocabulary'
import { display } from '../format.ts'
import { href } from '../url.ts'
import { RevisionList } from '../activity/revision-list.tsx'
import type { MetadataEntry } from '@platform/vocabulary'

/** The recent writes of the workspace, as its owners may read them. */
export function RecentChanges({
  ws,
  entries,
  mayAlter,
}: {
  ws: string
  /** The revisions the database showed. */
  entries: unknown[]
  mayAlter: boolean
}) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Recent changes</h2>
          <p>Every write in {ws}, recorded by its trigger in the same transaction.</p>
        </div>
        <a class="button button-secondary button-small" href={href('/activity', { ws })}>
          All activity
        </a>
      </header>
      {entries.length ? (
        <RevisionList entries={entries as never[]} compact showTable />
      ) : (
        <p class="panel-note">
          {mayAlter
            ? 'Nothing has changed here yet.'
            : "Revisions are read by the workspace's owners, so the log never reveals a field your grants hide."}
        </p>
      )}
    </section>
  )
}

/** What the workspace says of itself: its owner, what the reader may do, and its own metadata. */
export function WorkspaceAbout({
  ws,
  schema,
  shown,
  about,
}: {
  ws: string
  schema: SchemaInfo
  /** The name the workspace presents itself under. */
  shown: string
  /** The metadata the workspace carries. */
  about: MetadataEntry[]
}) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>About {shown}</h2>
          <p>What this workspace is, as its owner describes it.</p>
        </div>
        <a class="button button-secondary button-small" href={href('/workspace/settings', { ws })}>
          Settings
        </a>
      </header>
      <dl class="facts">
        <dt>Owner</dt>
        <dd class="mono">{schema.owner}</dd>
        <dt>You may</dt>
        <dd>
          {schema.can_alter
            ? 'Administer it: you own it'
            : schema.can_create
              ? 'Make collections here'
              : 'Use the collections granted to you'}
        </dd>
        {about
          .filter((entry) => !isReservedKey('workspace', entry.key))
          .map((entry) => (
            <Fragment key={entry.key}>
              <dt>{entry.key.replaceAll('_', ' ')}</dt>
              <dd class={typeof entry.value === 'string' ? '' : 'mono'}>{display(entry.value)}</dd>
            </Fragment>
          ))}
      </dl>
    </section>
  )
}
