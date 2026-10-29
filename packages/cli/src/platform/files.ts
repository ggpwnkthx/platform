/**
 * The files of the CLI.
 *
 * The CLI keeps two things on the machine of the caller: the profiles of
 * the deployments, and the credential of the caller. Both live in the
 * directories of the machine, and the credential lives in a file only
 * its owner can read.
 *
 * Nothing else is written: the CLI leaves no cache, no log and no state
 * that a reader of the directory has to guess the meaning of.
 */

import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  Credential,
  CredentialStorePort,
  ProfileStorePort,
  Profiles,
} from '../domains/contracts'
import { CliFailure } from '../domains/failure'

/** The name of the directory of the CLI, in the directories of the machine. */
const DIRECTORY = 'platformctl'

/** The mode of a file that holds a secret: its owner reads it, nobody else. */
const SECRET_MODE = 0o600

/**
 * The directory of the configuration of the CLI.
 *
 * @param environment the environment of the process.
 */
export function configDirectory(environment: Readonly<Record<string, string | undefined>>): string {
  const base = environment.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, DIRECTORY)
}

/**
 * The directory of the state of the CLI.
 *
 * @param environment the environment of the process.
 */
export function dataDirectory(environment: Readonly<Record<string, string | undefined>>): string {
  const base = environment.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  return join(base, DIRECTORY)
}

/**
 * Reads a json file, or reads nothing when there is none.
 *
 * @param path the path of the file.
 */
async function readJsonFile(path: string): Promise<unknown | null> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return null
  }
  if (content.trim() === '') return null
  try {
    return JSON.parse(content)
  } catch {
    throw new CliFailure(`the file ${path} does not hold valid json`, 8, 'invalid_file')
  }
}

/**
 * Writes a json file, and makes its directory when it is not there.
 *
 * @param path the path of the file.
 * @param value the value to write.
 */
async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * The store of the profiles of the deployments.
 */
export class FileProfileStore implements ProfileStorePort {
  /** The path of the file of the profiles. */
  readonly path: string

  /**
   * The store of the profiles of the deployments.
   *
   * @param path the path of the file of the profiles.
   */
  constructor(path: string) {
    this.path = path
  }

  /**
   * Reads the profiles, or the empty ones when there is no file.
   */
  async read(): Promise<Profiles> {
    const content = await readJsonFile(this.path)
    if (content === null) return { profiles: {} }
    if (typeof content !== 'object' || content === null) {
      throw new CliFailure(`the file ${this.path} does not hold profiles`, 8, 'invalid_file')
    }
    const record = content as Partial<Profiles>
    return {
      current: typeof record.current === 'string' ? record.current : undefined,
      profiles:
        typeof record.profiles === 'object' && record.profiles !== null
          ? (record.profiles as Profiles['profiles'])
          : {},
    }
  }

  /**
   * Writes the profiles.
   *
   * @param profiles the profiles to write.
   */
  async write(profiles: Profiles): Promise<void> {
    await writeJsonFile(this.path, profiles)
    // The profile may hold the secret of the client of the login: the
    // file is read by its owner only.
    await chmod(this.path, SECRET_MODE)
  }
}

/**
 * The store of the credential of the caller.
 */
export class FileCredentialStore implements CredentialStorePort {
  /** The path of the file of the credential. */
  readonly path: string

  /**
   * The store of the credential of the caller.
   *
   * @param path the path of the file of the credential.
   */
  constructor(path: string) {
    this.path = path
  }

  /**
   * Reads the credential, or null when the caller is not signed in.
   */
  async read(): Promise<Credential | null> {
    const content = await readJsonFile(this.path)
    if (content === null) return null
    if (typeof content !== 'object' || content === null) return null
    const record = content as Partial<Credential>
    if (typeof record.accessToken !== 'string') return null
    return {
      accessToken: record.accessToken,
      expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : undefined,
      subject: typeof record.subject === 'string' ? record.subject : undefined,
    }
  }

  /**
   * Writes the credential, in a file only its owner can read.
   *
   * @param credential the credential to write.
   */
  async write(credential: Credential): Promise<void> {
    await writeJsonFile(this.path, credential)
    // The mode of a file that is written again is not changed by the
    // write: the credential is read by its owner only, whatever the
    // mode of the file was before.
    await chmod(this.path, SECRET_MODE)
  }

  /** Removes the credential. */
  async clear(): Promise<void> {
    try {
      await rm(this.path, { force: true })
    } catch {
      // The file is not there: the caller is signed out either way.
    }
  }
}
