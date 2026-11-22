import type { ReachInfo } from '@platform/data'
import { type Held, type Wanted, narrows } from '@platform/vocabulary'
import { Notice } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { Checkbox, Select } from '../../ui/form.tsx'
import { PlusIcon } from '../../ui/icons.tsx'
import { FieldMatrix } from './fields.tsx'
import type { GrantState } from './state.ts'
import { UsageNotice } from './usage.tsx'
import { count, holdOf, reachesMore, reachOf } from '../model.ts'
import { Mark } from '../rights.tsx'

const modes = [
  { value: 'none', label: 'Not held' },
  { value: 'all', label: 'The whole collection' },
  { value: 'some', label: 'Chosen fields' },
] as const

const explains: Record<string, string> = {
  SELECT: 'Read rows, and name the fields in a filter or a sort.',
  INSERT: 'Add rows, setting the fields it holds.',
  UPDATE: 'Change the fields it holds in rows it reaches.',
  DELETE: 'Remove rows it reaches.',
  TRUNCATE: 'Empty the collection at once, past every row policy.',
  REFERENCES: 'Point a relation of another collection at this one.',
  TRIGGER: 'Attach a trigger to the collection.',
}

/** The privileges of the collection, each with the mode it is held in. */
function PrivilegeRows({
  choose,
  columns,
  givers,
  held,
  privileges,
  reach,
  wanted,
}: {
  choose: (privilege: string, mode: string) => void
  columns: string[]
  givers: (privilege: string) => string[]
  held: Record<string, Held>
  privileges: string[]
  reach: ReachInfo | undefined
  wanted: (privilege: string) => Wanted
}) {
  return (
    <ul class="grant-rows">
      {privileges.map((privilege) => {
        const now = wanted(privilege)
        const mode = now === 'none' ? 'none' : now === 'all' ? 'all' : 'some'
        const own = holdOf(held[privilege])
        const reached = reachOf(reach, privilege)
        return (
          <li key={privilege} class="grant-row">
            <Mark hold={mode} label="" />
            <div class="grant-name">
              <label class="mono" for={`grant-${privilege}`}>
                {privilege}
              </label>
              <small>{explains[privilege]}</small>
              {reachesMore(reached, own) && (
                <small class="grant-through">
                  Already reaches {reached === 'all' ? 'the whole collection' : 'some fields'}{' '}
                  through {givers(privilege).join(', ') || 'a group or PUBLIC'}.
                </small>
              )}
            </div>
            <Select
              id={`grant-${privilege}`}
              value={mode}
              onChange={(e) => choose(privilege, e.currentTarget.value)}
            >
              {modes
                .filter((m) => m.value !== 'some' || narrows(privilege))
                .map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.value === 'some' && Array.isArray(now)
                      ? `${now.length} of ${count(columns.length, 'field')}`
                      : m.label}
                  </option>
                ))}
            </Select>
          </li>
        )
      })}
    </ul>
  )
}

/** The privileges of the collection, the fields they are limited to, and what follows. */
export function GrantPrivileges({ editor }: { editor: GrantState }) {
  const {
    columns,
    choose,
    givers,
    grantsSomething,
    grantee,
    held,
    info,
    lacksUsage,
    listed,
    mayGrantUsage,
    more,
    option,
    privileges,
    reach,
    schema,
    set,
    setMore,
    setOption,
    setWithUsage,
    table,
    wanted,
    withUsage,
    workspace,
  } = editor
  return (
    <>
      <section class="drawer-section">
        <h3 class="drawer-title">Privileges</h3>
        <PrivilegeRows
          choose={choose}
          columns={columns}
          givers={givers}
          held={held}
          privileges={privileges}
          reach={reach}
          wanted={wanted}
        />
        {!more && (
          <div class="row-actions row-start">
            <Button small tone="ghost" icon={<PlusIcon size={14} />} onClick={() => setMore(true)}>
              TRUNCATE, REFERENCES, TRIGGER
            </Button>
          </div>
        )}
      </section>
      {listed.length > 0 && (
        <section class="drawer-section">
          <h3 class="drawer-title">Fields</h3>
          <p class="drawer-note">
            A privilege limited to fields names them: a field added to the collection later is not
            among them until it is granted too.
          </p>
          <FieldMatrix columns={columns} listed={listed} set={set} wanted={wanted} />
        </section>
      )}
      <Checkbox
        checked={option}
        onChange={setOption}
        label="With grant option"
        hint="The role may pass on what is newly granted here."
      />
      {lacksUsage && (
        <UsageNotice
          grantee={grantee}
          mayGrantUsage={mayGrantUsage}
          owner={workspace?.owner}
          schema={schema}
          setWithUsage={setWithUsage}
          withUsage={withUsage}
        />
      )}
      {info?.rls && grantsSomething && (
        <Notice tone="info" title="Row security is on">
          A grant says which statements the role may run; the row policies of {table} say which rows
          they reach. A role no policy applies to reaches no row.
        </Notice>
      )}
    </>
  )
}
