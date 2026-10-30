import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateRawSync, gzipSync } from 'node:zlib'
import { TofuInfrastructure } from '../src/platform/tofu'
import {
  archiveOf,
  digestOf,
  entriesOfTarGz,
  entriesOfZip,
  installDirectoryOf,
  installTofu,
  parseSums,
  targetOf,
  TOFU_VERSION,
  urlOf,
} from '../src/platform/tofu-release'

/**
 * The release of the tool that writes the infrastructure.
 *
 * A machine that holds no tool takes the one of the release: the
 * tests prove that the CLI reads the archive of the system it runs on,
 * that it proves the archive against the digest the release published,
 * and that it writes the tool where the next run finds it.
 */

/** Joins the parts of a file. */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) length += part.length
  const joined = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

/**
 * The archive of a tar, as a release publishes it.
 *
 * @param files the files of the archive.
 */
function tarOf(files: Readonly<Record<string, string>>): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const [name, content] of Object.entries(files)) {
    const body = encoder.encode(content)
    const header = new Uint8Array(512)
    const write = (text: string, start: number, length: number): void => {
      header.set(encoder.encode(text).subarray(0, length), start)
    }
    write(name, 0, 100)
    write('000644 \0', 100, 8)
    write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12)
    write('00000000000\0', 136, 12)
    header.fill(0x20, 148, 156)
    write('0', 156, 1)
    write('ustar\0', 257, 6)
    write('00', 263, 2)
    let sum = 0
    for (const byte of header) sum += byte
    write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8)
    parts.push(header, body)
    const padding = (512 - (body.length % 512)) % 512
    if (padding > 0) parts.push(new Uint8Array(padding))
  }
  parts.push(new Uint8Array(1024))
  return concat(parts)
}

/**
 * The archive of a zip, as a release publishes it.
 *
 * @param files the files of the archive.
 */
function zipOf(files: Readonly<Record<string, string>>): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const raw = encoder.encode(content)
    const compressed = new Uint8Array(deflateRawSync(raw))
    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, 8, true)
    localView.setUint32(18, compressed.length, true)
    localView.setUint32(22, raw.length, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    parts.push(local, compressed)
    const entry = new Uint8Array(46 + nameBytes.length)
    const entryView = new DataView(entry.buffer)
    entryView.setUint32(0, 0x02014b50, true)
    entryView.setUint16(10, 8, true)
    entryView.setUint32(20, compressed.length, true)
    entryView.setUint32(24, raw.length, true)
    entryView.setUint16(28, nameBytes.length, true)
    entryView.setUint32(42, offset, true)
    entry.set(nameBytes, 46)
    central.push(entry)
    offset += local.length + compressed.length
  }
  const size = central.reduce((sum, entry) => sum + entry.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, Object.keys(files).length, true)
  endView.setUint16(10, Object.keys(files).length, true)
  endView.setUint32(12, size, true)
  endView.setUint32(16, offset, true)
  return concat([...parts, ...central, end])
}

/**
 * The transport of a release, in the tests.
 *
 * @param files the files of the release, by their name.
 */
function releaseOf(
  files: Readonly<Record<string, Uint8Array>>
): (url: string) => Promise<Response> {
  return async (url: string): Promise<Response> => {
    const name = url.slice(url.lastIndexOf('/') + 1)
    const body = files[name]
    if (body === undefined) return new Response('not there', { status: 404 })
    return new Response(new Uint8Array(body), { status: 200 })
  }
}

describe('the system of a release', () => {
  test('the release publishes a tool for the system of the machine', () => {
    expect(targetOf('linux', 'x64')).toEqual({ os: 'linux', arch: 'amd64', archive: 'tar.gz' })
    expect(targetOf('darwin', 'arm64')).toEqual({ os: 'darwin', arch: 'arm64', archive: 'tar.gz' })
    expect(targetOf('win32', 'x64')).toEqual({ os: 'windows', arch: 'amd64', archive: 'zip' })
    expect(targetOf('linux', 'mips')).toBeNull()
    expect(targetOf('plan9', 'x64')).toBeNull()
  })

  test('the archive of a system is named after the version and the system', () => {
    const target = targetOf('linux', 'x64')
    expect(target).not.toBeNull()
    expect(archiveOf('1.13.2', target!)).toBe('tofu_1.13.2_linux_amd64.tar.gz')
    expect(urlOf('1.13.2', target!)).toBe(
      'https://github.com/opentofu/opentofu/releases/download/v1.13.2/tofu_1.13.2_linux_amd64.tar.gz'
    )
  })

  test('the digests of a release are named after the version', () => {
    expect(urlOf('1.13.2', targetOf('win32', 'x64')!)).toBe(
      'https://github.com/opentofu/opentofu/releases/download/v1.13.2/tofu_1.13.2_windows_amd64.zip'
    )
  })
})

describe('the digests of a release', () => {
  test('a digest is read with the name of the archive it belongs to', () => {
    const digests = parseSums(
      `${digestOf(new TextEncoder().encode('the tool'))}  tofu_1.13.2_linux_amd64.tar.gz\nnot a digest line\n`
    )
    expect(digests.size).toBe(1)
    expect(digests.get('tofu_1.13.2_linux_amd64.tar.gz')).toBe(
      digestOf(new TextEncoder().encode('the tool'))
    )
  })
})

describe('the archives of a release', () => {
  test('the files of a tar are read', () => {
    const archive = new Uint8Array(gzipSync(tarOf({ tofu: 'the tool', LICENSE: 'the papers' })))
    const entries = entriesOfTarGz(archive)
    expect(entries.get('tofu')).toBeDefined()
    expect(new TextDecoder().decode(entries.get('tofu'))).toBe('the tool')
    expect(new TextDecoder().decode(entries.get('LICENSE'))).toBe('the papers')
  })

  test('the files of a zip are read', () => {
    const entries = entriesOfZip(zipOf({ 'tofu.exe': 'the tool' }))
    expect(new TextDecoder().decode(entries.get('tofu.exe'))).toBe('the tool')
  })
})

describe('the writing of the tool', () => {
  test('the tool of the release is written in the directory of the machine', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tofu-release-'))
    try {
      const archive = new Uint8Array(gzipSync(tarOf({ tofu: 'the tool' })))
      const name = `tofu_${TOFU_VERSION}_linux_amd64.tar.gz`
      const download = releaseOf({
        [`tofu_${TOFU_VERSION}_SHA256SUMS`]: new TextEncoder().encode(
          `${digestOf(archive)}  ${name}\n`
        ),
        [name]: archive,
      })
      const path = await installTofu({
        version: TOFU_VERSION,
        platform: 'linux',
        arch: 'x64',
        directory,
        download,
      })
      expect(path).toBe(join(directory, 'tofu'))
      expect(await readFile(path, 'utf8')).toBe('the tool')
      const written = await stat(path)
      expect(written.mode & 0o111).toBeGreaterThan(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an archive that is not the one the release published is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tofu-release-'))
    try {
      const archive = new Uint8Array(gzipSync(tarOf({ tofu: 'the tool' })))
      const name = `tofu_${TOFU_VERSION}_linux_amd64.tar.gz`
      const download = releaseOf({
        [`tofu_${TOFU_VERSION}_SHA256SUMS`]: new TextEncoder().encode(
          `${'0'.repeat(64)}  ${name}\n`
        ),
        [name]: archive,
      })
      await expect(
        installTofu({
          version: TOFU_VERSION,
          platform: 'linux',
          arch: 'x64',
          directory,
          download,
        })
      ).rejects.toThrow('not the one the release published')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a system the release publishes no tool for is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tofu-release-'))
    try {
      await expect(
        installTofu({
          version: TOFU_VERSION,
          platform: 'plan9',
          arch: 'x64',
          directory,
          download: releaseOf({}),
        })
      ).rejects.toThrow('is not published for plan9 x64')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the directory of the tool is in the working directory', () => {
    expect(installDirectoryOf('/home/operator/project')).toBe(
      join('/home/operator/project', '.platform', 'tofu', TOFU_VERSION)
    )
  })
})

describe('the tool of the machine', () => {
  test('the version the CLI downloads is the version the continuous integration installs', () => {
    const workflow = resolve(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'ci.yml')
    if (!existsSync(workflow)) return
    const pinned = readFileSync(workflow, 'utf8').match(/tofu_version:\s*'([^']+)'/)?.[1]
    expect(pinned).toBe(TOFU_VERSION)
  })

  test('a machine that holds no tool takes the one of the release', async () => {
    const working = await mkdtemp(join(tmpdir(), 'tofu-tool-'))
    try {
      const script = '#!/bin/sh\necho "OpenTofu v1.13.2"\n'
      const archive = new Uint8Array(gzipSync(tarOf({ tofu: script })))
      const name = `tofu_${TOFU_VERSION}_linux_amd64.tar.gz`
      const download = releaseOf({
        [`tofu_${TOFU_VERSION}_SHA256SUMS`]: new TextEncoder().encode(
          `${digestOf(archive)}  ${name}\n`
        ),
        [name]: archive,
      })
      const tool = new TofuInfrastructure(
        { PATH: '', TOFU_BINARY: undefined },
        { working, download }
      )
      expect(await tool.version()).toBe('1.13.2')
      const written = join(working, '.platform', 'tofu', TOFU_VERSION, 'tofu')
      expect(await readFile(written, 'utf8')).toBe(script)
      await chmod(written, 0o755)
    } finally {
      await rm(working, { recursive: true, force: true })
    }
  })

  test('a reader who refuses the download is told that the tool is not there', async () => {
    const tool = new TofuInfrastructure(
      { PATH: '', TOFU_BINARY: undefined, TOFU_DOWNLOAD: 'off' },
      { working: await mkdtemp(join(tmpdir(), 'tofu-tool-')) }
    )
    await expect(tool.version()).rejects.toThrow(
      'the tool that writes the infrastructure is not on the path'
    )
  })
})
