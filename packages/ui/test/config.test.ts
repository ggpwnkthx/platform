import { describe, expect, test } from 'bun:test'
import { relayUrl } from '../src/config.ts'
import { paletteBlack, paletteWhite } from '../src/metadata/color.ts'

/**
 * The interface's own configuration: the relay it reaches PostgreSQL through, and the two
 * inks a colour is read with. The relay is addressed absolutely, so that the page's own
 * scheme is the one it speaks.
 */
describe('The relay the page reaches PostgreSQL through', () => {
  test('an address of its own is used as it is', () => {
    const page = new URL('https://console.example.com/content')
    expect(relayUrl('wss://relay.example.com/pg', page)).toBe('wss://relay.example.com/pg')
    expect(relayUrl('ws://relay.example.com/pg', page)).toBe('ws://relay.example.com/pg')
  })

  test('a path is resolved against the page, and speaks the page’s own scheme', () => {
    const secure = new URL('https://console.example.com/content')
    expect(relayUrl('/pg', secure)).toBe('wss://console.example.com/pg')
    const plain = new URL('http://localhost:5173/content')
    expect(relayUrl('/pg', plain)).toBe('ws://localhost:5173/pg')
    // A host without a scheme is a path, as any address is.
    expect(relayUrl('relay.example.com/pg', plain)).toBe('ws://localhost:5173/relay.example.com/pg')
  })
})

describe('The two inks a colour is read with', () => {
  test('are the palette’s own black and white', () => {
    expect(paletteBlack).toBe('#141414')
    expect(paletteWhite).toBe('#fafafa')
  })
})
