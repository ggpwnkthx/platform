import { expect, test } from 'bun:test'
import { titleAt } from '../src/routes.ts'

test('a page reached by a link is titled as its own file is', () => {
  expect(titleAt('/sql', 'Content · Platform')).toBe('SQL · Platform')
  expect(titleAt('/content/records/', 'SQL · Platform')).toBe('Records · Platform')
})

test('what the build added after the site name is kept', () => {
  expect(titleAt('/model', 'Content · Platform · dev')).toBe('Data model · Platform · dev')
  expect(titleAt('/access', 'Data model · Platform (newsroom)')).toBe('Roles · Platform (newsroom)')
})

test('a path that is no page is the sign-in, and a bare title gets the site name', () => {
  expect(titleAt('/nowhere', 'Content · Platform')).toBe('Sign in · Platform')
  expect(titleAt('/activity', '')).toBe('Activity · Platform')
})
