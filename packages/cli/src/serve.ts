import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Serves a built site as the files it is, with the headers its `_headers` file lists: what
 * the local stack puts where a real deployment has a CDN. `bun serve.ts DIR PORT`.
 */
const [dir = '.', port = '8080'] = process.argv.slice(2)
const listed = existsSync(join(dir, '_headers')) ? readFileSync(join(dir, '_headers'), 'utf8') : ''
const headers = Object.fromEntries(
  [...listed.matchAll(/^ {2}([\w-]+): (.*)$/gm)].map((m) => [m[1]!, m[2]!])
)
Bun.serve({
  port: Number(port),
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname)
    const file = Bun.file(join(dir, path.endsWith('/') ? `${path}index.html` : path))
    if (path.includes('..') || !(await file.exists()))
      return new Response('Not found\n', { status: 404, headers })
    return new Response(file, { headers })
  },
})
console.log(`Serving ${dir} on port ${port}.`)
