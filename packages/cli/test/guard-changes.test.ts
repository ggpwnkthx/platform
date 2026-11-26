import { beforeAll, describe, expect, test } from 'bun:test'
import {
  columnDefaultStatement,
  columnTypeStatement,
  enableTriggerStatement,
  indexDraftStatement,
  renameColumnStatement,
  renameTableStatement,
  routineStatement,
  triggerStatement,
  viewStatement,
} from '../../core/src/index.ts'
import { alice, as, guarded, state } from './guard-world.ts'

beforeAll(guarded, 120000)

/** What the interface now offers an ordinary owner, met by the guard: allowed, and the history kept. */
describe('the guard, and the changes the interface offers an owner', () => {
  test('leaves an owner a renamed table and column, a new type and default, triggers and views of their own', async () => {
    const statements = [
      'ALTER TABLE alice_ws.notes ADD COLUMN words integer;',
      renameTableStatement('alice_ws', 'notes', 'memos'),
      renameColumnStatement('alice_ws', 'memos', 'words', 'word_count'),
      columnTypeStatement('alice_ws', 'memos', 'word_count', 'bigint'),
      columnDefaultStatement('alice_ws', 'memos', 'word_count', '0'),
      indexDraftStatement('alice_ws', 'memos', {
        columns: ['word_count'],
        where: 'word_count > 0',
      }),
      routineStatement({
        schema: 'alice_ws',
        name: 'touch',
        kind: 'function',
        returns: 'trigger',
        language: 'plpgsql',
        body: 'BEGIN RETURN NEW; END',
      }),
      triggerStatement({
        schema: 'alice_ws',
        table: 'memos',
        name: 'memos_touch',
        timing: 'BEFORE',
        events: ['UPDATE'],
        row: true,
        function: 'alice_ws.touch()',
      }),
      enableTriggerStatement('alice_ws', 'memos', 'memos_touch', false),
      viewStatement({
        schema: 'alice_ws',
        name: 'counted',
        query: 'SELECT count(*) FROM alice_ws.memos',
      }),
      renameTableStatement('alice_ws', 'memos', 'notes'),
    ]
    for (const statement of statements) expect(await as(alice, statement)).toBe('done')
    // The platform's own triggers are as they were; the owner's own is the one disabled.
    expect((await state()).rls).toBe(true)
    expect((await state()).enabled).toBe('DOOO')
  })
})
