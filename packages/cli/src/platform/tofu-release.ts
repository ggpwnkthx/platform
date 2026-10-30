/**
 * The release of the tool that writes the infrastructure.
 *
 * The tool is published as a release: a version of the tool, an archive
 * for every system it runs on, and the digests of the archives. A
 * machine that holds no tool needs one, and the release is where the
 * right one is: the CLI reads the archive of the system it runs on,
 * proves it against the digest the release published, and writes the
 * tool in the working directory.
 *
 * The version is pinned. A tool that reads the templates another way
 * changes what a deployment is, and the version of this file is the
 * version the continuous integration installs.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'
import { CliFailure } from '../domains/failure'

/**
 * The version of the tool the CLI downloads.
 *
 * The version is the one the continuous integration installs: the tool
 * that proves the templates is the tool that writes them, and a
 * deployment that runs another one runs a deployment nobody proved.
 */
export const TOFU_VERSION = '1.13.2'

/** The timeout of a download, in milliseconds. */
const DOWNLOAD_TIMEOUT_MS = 300_000

/** The place the releases of the tool are published in. */
const RELEASES = 'https://github.com/opentofu/opentofu/releases/download'

/**
 * The transport that reads a file of a release.
 *
 * The transport answers with the answer of the network, and the CLI
 * reads it: the download of the tool is a call like any other.
 */
export type Download = (url: string) => Promise<Response>

/** The system a release of the tool is published for. */
export interface TofuTarget {
  /** The system the tool runs on. */
  readonly os: string
  /** The shape of the machine the tool runs on. */
  readonly arch: string
  /** The shape of the archive the release publishes for it. */
  readonly archive: 'tar.gz' | 'zip'
}

/** The systems the release publishes a tool for. */
const SYSTEMS: Readonly<Record<string, string>> = {
  linux: 'linux',
  darwin: 'darwin',
  win32: 'windows',
  freebsd: 'freebsd',
  openbsd: 'openbsd',
  sunos: 'solaris',
}

/** The shapes of the machine the release publishes a tool for. */
const SHAPES: Readonly<Record<string, string>> = {
  x64: 'amd64',
  amd64: 'amd64',
  ia32: '386',
  arm64: 'arm64',
  arm: 'arm',
}

/**
 * The system a release of the tool is published for.
 *
 * A system the release publishes no tool for is a system the CLI
 * refuses: a tool of another system is a tool that does not run.
 *
 * @param platform the system the process runs on.
 * @param arch the shape of the machine the process runs on.
 */
export function targetOf(platform: string, arch: string): TofuTarget | null {
  const system = SYSTEMS[platform]
  const shape = SHAPES[arch]
  if (system === undefined || shape === undefined) return null
  return { os: system, arch: shape, archive: system === 'windows' ? 'zip' : 'tar.gz' }
}

/**
 * The name of the tool on a system.
 *
 * The tool of a system of windows is a program the shell runs by its
 * name, and the name of a program of windows carries its extension.
 *
 * @param target the system the tool runs on.
 */
export function binaryNameOf(target: TofuTarget): string {
  return target.os === 'windows' ? 'tofu.exe' : 'tofu'
}

/**
 * The name of the archive the release publishes for a system.
 *
 * @param version the version of the tool.
 * @param target the system the tool runs on.
 */
export function archiveOf(version: string, target: TofuTarget): string {
  return `tofu_${version}_${target.os}_${target.arch}.${target.archive}`
}

/**
 * The address of the archive the release publishes for a system.
 *
 * @param version the version of the tool.
 * @param target the system the tool runs on.
 */
export function urlOf(version: string, target: TofuTarget): string {
  return `${RELEASES}/v${version}/${archiveOf(version, target)}`
}

/**
 * The address of the digests the release published.
 *
 * @param version the version of the tool.
 */
export function sumsUrlOf(version: string): string {
  return `${RELEASES}/v${version}/tofu_${version}_SHA256SUMS`
}

/**
 * The digests a release published, by the name of the archive.
 *
 * The file of the digests holds a line per archive: the digest of the
 * archive and the name of the archive. A line the file does not hold
 * names no archive, and a digest that is not there is a digest the CLI
 * cannot prove.
 *
 * @param text the file of the digests.
 */
export function parseSums(text: string): Map<string, string> {
  const digests = new Map<string, string>()
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const digest = parts[0]!
    const name = parts[parts.length - 1]!
    if (!/^[0-9a-f]{64}$/i.test(digest)) continue
    digests.set(name, digest.toLowerCase())
  }
  return digests
}

/**
 * The digest of a file, as the release publishes it.
 *
 * @param data the bytes of the file.
 */
export function digestOf(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * The text of a part of a file, up to its first null byte.
 *
 * @param bytes the file.
 * @param start where the part starts.
 * @param length how long the part is.
 */
function readText(bytes: Uint8Array, start: number, length: number): string {
  const end = Math.min(start + length, bytes.length)
  let text = ''
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index]!
    if (byte === 0) break
    text += String.fromCharCode(byte)
  }
  return text
}

/**
 * The number a part of a file holds, written in octal.
 *
 * @param bytes the file.
 * @param start where the part starts.
 * @param length how long the part is.
 */
function readNumber(bytes: Uint8Array, start: number, length: number): number {
  const text = readText(bytes, start, length).trim()
  if (text === '') return 0
  const parsed = Number.parseInt(text, 8)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The files of an archive of a tar, by their name.
 *
 * The archive of the tool holds the tool and the papers of the release.
 * Only the files are read: a directory of the archive holds nothing
 * the CLI writes.
 *
 * @param data the archive.
 */
export function entriesOfTar(data: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>()
  let offset = 0
  let long: string | undefined
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    let empty = true
    for (const byte of header) {
      if (byte !== 0) {
        empty = false
        break
      }
    }
    if (empty) break
    const name = readText(header, 0, 100)
    const prefix = readText(header, 345, 155)
    const size = readNumber(header, 124, 12)
    const kind = String.fromCharCode(header[156] ?? 0)
    const body = data.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (kind === 'L') {
      long = readText(body, 0, body.length)
      continue
    }
    if (kind === 'x' || kind === 'g') continue
    const full = long ?? (prefix === '' ? name : `${prefix}/${name}`)
    long = undefined
    if (kind === '0' || kind === '\0' || kind === '') entries.set(full, body)
  }
  return entries
}

/**
 * The files of an archive of a tar, compressed.
 *
 * @param data the archive.
 */
export function entriesOfTarGz(data: Uint8Array): Map<string, Uint8Array> {
  let tar: Buffer
  try {
    tar = gunzipSync(data)
  } catch (error) {
    throw new CliFailure(
      `the archive of the tool is not a tar the CLI can read: ${(error as Error).message}`,
      8,
      'invalid_tool'
    )
  }
  return entriesOfTar(new Uint8Array(tar))
}

/**
 * The place the file of the index of a zip ends.
 *
 * @param view the file of the archive.
 * @param length how long the file is.
 */
function endOfCentralDirectory(view: DataView, length: number): number {
  const lowest = Math.max(0, length - 22 - 0xffff)
  for (let index = length - 22; index >= lowest; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) return index
  }
  return -1
}

/**
 * The files of an archive of a zip, by their name.
 *
 * The archive of a system of windows is a zip, and a zip holds the
 * files in the middle of the archive and their names in the index at
 * its end.
 *
 * @param data the archive.
 */
export function entriesOfZip(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const end = endOfCentralDirectory(view, data.length)
  if (end < 0) {
    throw new CliFailure('the archive of the tool is not a zip the CLI can read', 8, 'invalid_tool')
  }
  const count = view.getUint16(end + 10, true)
  const decoder = new TextDecoder()
  const entries = new Map<string, Uint8Array>()
  let offset = view.getUint32(end + 16, true)
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > data.length || view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength))
    const localName = view.getUint16(local + 26, true)
    const localExtra = view.getUint16(local + 28, true)
    const start = local + 30 + localName + localExtra
    const raw = data.subarray(start, start + compressed)
    let content: Uint8Array
    try {
      content = method === 0 ? raw : new Uint8Array(inflateRawSync(raw))
    } catch (error) {
      throw new CliFailure(
        `the archive of the tool is not a zip the CLI can read: ${(error as Error).message}`,
        8,
        'invalid_tool'
      )
    }
    entries.set(name, content)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * The file of an archive the CLI is looking for.
 *
 * A file of an archive may be named with the directory it is in, and
 * the CLI looks for the name of the tool at the end of the name of the
 * file.
 *
 * @param entries the files of the archive.
 * @param name the name of the file.
 */
export function entryOf(entries: Map<string, Uint8Array>, name: string): Uint8Array | undefined {
  const direct = entries.get(name)
  if (direct !== undefined) return direct
  for (const [candidate, content] of entries) {
    if (candidate.endsWith(`/${name}`)) return content
  }
  return undefined
}

/**
 * The directory the tool is written in, in the working directory.
 *
 * The tool is a file of the machine of the operator, and it is written
 * in the directory the CLI runs in: the tool of a deployment is the
 * tool of the directory the deployment is written in.
 *
 * @param working the directory the CLI runs in.
 * @param version the version of the tool.
 */
export function installDirectoryOf(working: string, version: string = TOFU_VERSION): string {
  return join(working, '.platform', 'tofu', version)
}

/**
 * The bytes of a file of a release.
 *
 * @param url the address of the file.
 * @param download the transport that reads it.
 */
async function readBytes(url: string, download: Download): Promise<Uint8Array> {
  const response = await answerOf(url, download)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * The text of a file of a release.
 *
 * @param url the address of the file.
 * @param download the transport that reads it.
 */
async function textOf(url: string, download: Download): Promise<string> {
  const response = await answerOf(url, download)
  return await response.text()
}

/**
 * The answer of the network for a file of a release.
 *
 * A file that is not there is a file the release does not publish, and
 * a network that is down is a network the CLI cannot reach.
 *
 * @param url the address of the file.
 * @param download the transport that reads it.
 */
async function answerOf(url: string, download: Download): Promise<Response> {
  let response: Response
  try {
    response = await download(url)
  } catch (error) {
    throw new CliFailure(
      `the release of the tool cannot be read: ${(error as Error).message}`,
      7,
      'unreachable'
    )
  }
  if (!response.ok) {
    throw new CliFailure(`the release of the tool is not there: ${url}`, 4, 'not_found')
  }
  return response
}

/**
 * The transport that reads a file of a release with the network.
 *
 * The download of the tool is a big file, and a download that hangs
 * holds the shell of the operator for as long as it hangs.
 *
 * @param url the address of the file.
 */
async function timedFetch(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
}

/** What the installation of the tool needs to know. */
export interface InstallOptions {
  /** The version of the tool. */
  readonly version?: string
  /** The system the process runs on. */
  readonly platform?: string
  /** The shape of the machine the process runs on. */
  readonly arch?: string
  /** The directory the tool is written in. */
  readonly directory: string
  /** The transport that reads the release. */
  readonly download?: Download
}

/**
 * The tool of a release, written in a directory.
 *
 * The tool of a machine that holds one is the tool of the machine, and
 * the CLI writes nothing: the release is read when there is no tool.
 *
 * The archive is proved against the digest the release published before
 * it is opened: an archive that is not the one the release published is
 * an archive nobody published.
 *
 * @param options what the installation needs to know.
 */
export async function installTofu(options: InstallOptions): Promise<string> {
  const version = options.version ?? TOFU_VERSION
  const target = targetOf(options.platform ?? process.platform, options.arch ?? process.arch)
  if (target === null) {
    throw new CliFailure(
      `the tool that writes the infrastructure is not published for ${options.platform ?? process.platform} ${options.arch ?? process.arch}`,
      4,
      'unsupported_system'
    )
  }
  const name = binaryNameOf(target)
  const path = join(options.directory, name)
  if (existsSync(path)) return path

  const download = options.download ?? timedFetch
  const archive = archiveOf(version, target)
  const digests = parseSums(await textOf(sumsUrlOf(version), download))
  const expected = digests.get(archive)
  if (expected === undefined) {
    throw new CliFailure(`the release of the tool does not publish ${archive}`, 4, 'not_found')
  }
  const data = await readBytes(urlOf(version, target), download)
  if (digestOf(data) !== expected) {
    throw new CliFailure(
      `the archive of the tool is not the one the release published: ${archive}`,
      8,
      'invalid_tool'
    )
  }
  const entries = target.archive === 'zip' ? entriesOfZip(data) : entriesOfTarGz(data)
  const binary = entryOf(entries, name)
  if (binary === undefined) {
    throw new CliFailure(
      `the archive of the tool holds no ${name}: the release published something else`,
      8,
      'invalid_tool'
    )
  }
  await mkdir(options.directory, { recursive: true })
  await writeFile(path, binary)
  await chmod(path, 0o755)
  return path
}
