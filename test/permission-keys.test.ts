/**
 * The vocabulary of the permission keys.
 *
 * The keys of the permissions are written in the code of the three
 * services that own them, and the services share no code. The check
 * holds the three copies of the vocabulary together, and it fails the
 * build when a key is renamed in one place and not in the others.
 */

import { describe, expect, test } from 'bun:test'
import { checkPermissionKeys } from '../scripts/check-permission-keys'

describe('the vocabulary of the permission keys', () => {
  test('the three copies of the vocabulary are the same', () => {
    expect(checkPermissionKeys()).toEqual([])
  })
})
