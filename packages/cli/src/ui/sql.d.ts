/**
 * A SQL file, imported as its text: `import sql from './demo.sql' with { type: 'text' }`.
 *
 * The builder is Bun, which reads such a file as a string, in a build and in a test alike.
 * Bun's own types say so for a few kinds of file, and SQL is not one of them, so it is said
 * here, once, beside the builder: a site that installs a database of its own in the page
 * imports its scripts this way.
 */
declare module '*.sql' {
  const text: string
  export default text
}
