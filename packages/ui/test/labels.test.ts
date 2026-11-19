import { describe, expect, test } from 'bun:test'
import { operators } from '@platform/data'
import { operatorLabels } from '../src/content/labels.ts'
import { modeLabels } from '../src/metadata/labels.ts'
import { customModes, situationModes, viewModes } from '@platform/vocabulary'

/**
 * What the interface calls things. The operators, the situations and the modes are the
 * platform's own; the words are the interface's, and every one of them must have a word:
 * an operator with no way to be read would be shown as nothing at all.
 */

describe('The words the interface shows', () => {
  test('every operator has a way to be read', () => {
    for (const op of operators) expect(operatorLabels[op]).toBeTruthy()
  })

  test('every mode has a way to be read', () => {
    for (const mode of viewModes) expect(modeLabels[mode]).toBeTruthy()
  })

  test('every mode a situation may be told is a mode the platform knows', () => {
    for (const modes of Object.values(situationModes))
      for (const mode of modes) expect(viewModes).toContain(mode)
  })

  test('every mode a view of the owner’s own may be told is a mode the platform knows', () => {
    for (const mode of customModes) expect(viewModes).toContain(mode)
  })
})
