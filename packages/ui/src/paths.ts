import { join } from 'node:path'

/**
 * Where the interface lives: its own folder, and the folders inside it. The paths are
 * published so that whatever builds or serves the interface — the deployment, the
 * development server — finds the same files the interface itself was written against.
 */
export const root = join(import.meta.dir, '..')

/** The interface's source: the application, its pages and its styles. */
export const sources = join(root, 'src')
