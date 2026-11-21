import { describe, expect, test } from 'bun:test'

/**
 * The page as it opens: the bundle's own entry, which opens the application into the root the
 * server wrote for it. There is nothing of the page's state in the bundle, so what it does
 * when there is no root to open into is the whole of it.
 */
describe('The page as it opens', () => {
  test('does nothing without a root to open into', async () => {
    const opened: string[] = []
    globalThis.document = {
      getElementById: (id: string) => {
        opened.push(id)
        return null
      },
    } as unknown as Document
    try {
      await import('../src/main.tsx')
      expect(opened).toEqual(['root'])
    } finally {
      delete (globalThis as { document?: Document }).document
    }
  })
})
