import { Fragment } from 'preact'
import { activity, columnsOf, metadata, systemWorkspaceName, tablesIn } from '@platform/data'
import { qualified, workspaceTarget, isReservedKey } from '@platform/vocabulary'
import { display, count as formatCount } from '../format.ts'
import { useLoad, useSession } from '../session.tsx'
import { Page, useWorkspace } from '../shell.tsx'
import { presentationOf } from '@platform/data'
import { href } from '../url.ts'
import { Avatar } from '../ui/avatar.tsx'
import { Badge, Empty, Notice } from '../ui/bits.tsx'
import { Action } from '../ui/button.tsx'
import {
  CollectionIcon,
  ContentIcon,
  iconFor,
  LockIcon,
  PlusIcon,
  WorkspaceIcon,
} from '../ui/icons.tsx'
import { RevisionList } from '../activity/activity.tsx'
import { Rights } from '../access/rights.tsx'

/** A workspace at a glance: its collections, how many rows reach you, and what you may do. */
export function ContentHome() {
  const { catalog, identity, presentations } = useSession()
  const ws = useWorkspace()
  const schema = catalog.schemas.find((s) => s.name === ws)
  // The platform's own workspace: its collections are read like any other, each under its
  // own row security, and there is nothing of it to administer from here.
  const system = schema?.kind === 'system'
  const shown = presentationOf(presentations, ws)
  const WorkspaceGlyph = iconFor(shown.icon) ?? WorkspaceIcon
  const tables = tablesIn(catalog, ws)
  const counts = useLoad(
    ws
      ? async (db) => {
          const out: Record<string, number | null> = {}
          for (const t of tables) {
            // A count needs SELECT on the table or on any one of its columns.
            const readable = columnsOf(catalog, ws, t.name).some((c) => c.can_select)
            if (!t.can_select && !readable) {
              out[t.name] = null
              continue
            }
            try {
              const r = await db.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM ${qualified(ws, t.name)}`
              )
              out[t.name] = r.rows[0]?.n ?? 0
            } catch {
              out[t.name] = null
            }
          }
          const about = await metadata(db, workspaceTarget(ws))
          // Revisions reach the workspace's owners; anyone else reads none, and that is an answer.
          const recent = await activity(db, { schema: ws, limit: 8 }).catch(() => [])
          return { counts: out, about, recent }
        }
      : null,
    [ws, tables.length]
  )
  const purpose = counts.data?.about.find((m) => m.key === 'purpose')?.value
  if (!schema)
    return (
      <Page title="Content" icon={<ContentIcon size={22} />}>
        <Empty
          icon={<WorkspaceIcon size={28} />}
          title="No workspace to show"
          actions={
            identity?.can_create_workspace ? (
              <a class="button button-primary" href="/workspace/new">
                <PlusIcon size={16} aria-hidden="true" />
                <span>New workspace</span>
              </a>
            ) : undefined
          }
        >
          PostgreSQL gives your role USAGE on no workspace yet. A workspace owner grants it with{' '}
          <span class="mono">GRANT USAGE ON SCHEMA …</span>
        </Empty>
      </Page>
    )
  return (
    <Page
      title={system ? systemWorkspaceName : (shown.displayName ?? ws)}
      crumbs={[{ label: 'Content' }]}
      icon={<WorkspaceGlyph size={22} />}
      presentation={shown}
      subtitle={
        system
          ? 'What the platform itself holds. PostgreSQL’s row security decides which rows reach you.'
          : typeof purpose === 'string'
            ? purpose
            : `Owned by ${schema.owner}`
      }
      actions={
        schema.can_create ? (
          <Action
            label="New collection"
            icon={<PlusIcon size={22} />}
            href={href('/model/new', { ws })}
          />
        ) : undefined
      }
    >
      {counts.error ? <Notice tone="danger" title="PostgreSQL did not answer" /> : null}
      {tables.length ? (
        <div class="tiles">
          {tables.map((t) => {
            const n = counts.data?.counts[t.name]
            const item = presentationOf(presentations, ws, t.name)
            return (
              <article key={t.name} class="tile">
                <a class="tile-link" href={href('/content/records', { ws, c: t.name })}>
                  <Avatar
                    presentation={item}
                    fallback={CollectionIcon}
                    class="tile-icon"
                    size={18}
                  />
                  <h2>{item.displayName ?? t.name}</h2>
                  {t.kind === 'v' && <Badge tone="outline">view</Badge>}
                </a>
                <p class="tile-count">
                  {n === undefined ? (
                    <span class="skeleton" />
                  ) : n === null ? (
                    <span class="tile-locked">
                      <LockIcon size={14} aria-hidden="true" /> rows hidden from you
                    </span>
                  ) : (
                    <>
                      <strong>{formatCount(n)}</strong>{' '}
                      {n === 1 ? 'row reaches you' : 'rows reach you'}
                    </>
                  )}
                </p>
                {t.comment && <p class="tile-note">{t.comment}</p>}
                <div class="tile-foot">
                  <Rights table={t} columns={columnsOf(catalog, ws, t.name)} compact />
                  {t.can_insert && (
                    <a
                      class="tile-add"
                      href={href('/content/item', { ws, c: t.name, id: '+' })}
                      aria-label={`New record in ${t.name}`}
                      title="New record"
                    >
                      <PlusIcon size={16} />
                    </a>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <Empty icon={<CollectionIcon size={28} />} title="No collection you may reach">
          {schema.can_create
            ? 'Make the first collection of this workspace.'
            : 'PostgreSQL shows you no table here: none exists yet, or none is granted to you.'}
        </Empty>
      )}
      {tables.length > 0 && counts.data && !system && (
        <div class="split">
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
            {counts.data.recent.length ? (
              <RevisionList entries={counts.data.recent} compact showTable />
            ) : (
              <p class="panel-note">
                {schema.can_alter
                  ? 'Nothing has changed here yet.'
                  : "Revisions are read by the workspace's owners, so the log never reveals a field your grants hide."}
              </p>
            )}
          </section>
          <section class="panel">
            <header class="panel-head">
              <div>
                <h2>About {shown.displayName ?? ws}</h2>
                <p>What this workspace is, as its owner describes it.</p>
              </div>
              <a
                class="button button-secondary button-small"
                href={href('/workspace/settings', { ws })}
              >
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
              {counts.data.about
                .filter((entry) => !isReservedKey('workspace', entry.key))
                .map((entry) => (
                  <Fragment key={entry.key}>
                    <dt>{entry.key.replaceAll('_', ' ')}</dt>
                    <dd class={typeof entry.value === 'string' ? '' : 'mono'}>
                      {display(entry.value)}
                    </dd>
                  </Fragment>
                ))}
            </dl>
          </section>
        </div>
      )}
    </Page>
  )
}
