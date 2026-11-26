/**
 * A script cut into its statements, at the semicolons that end one: not inside a string, a
 * quoted name, a dollar-quoted body or a comment. Each statement is then sent on its own, so
 * PostgreSQL still parses one statement at a time and nothing rides along with another.
 */
export function splitStatements(script: string): string[] {
  const out: string[] = []
  let start = 0
  let at = 0
  const n = script.length
  const skipTo = (end: string, from: number) => {
    const found = script.indexOf(end, from)
    return found < 0 ? n : found + end.length
  }
  while (at < n) {
    const c = script[at]!
    const next = script[at + 1]
    if (c === '-' && next === '-') at = skipTo('\n', at + 2)
    else if (c === '/' && next === '*') {
      // Block comments nest in PostgreSQL.
      let depth = 1
      at += 2
      while (at < n && depth) {
        const opens = script.startsWith('/*', at)
        const closes = script.startsWith('*/', at)
        depth += opens ? 1 : closes ? -1 : 0
        at += opens || closes ? 2 : 1
      }
    } else if (c === "'") {
      // An E'' string escapes with a backslash; any string doubles its quote.
      const escaped =
        /[eE]$/.test(script.slice(Math.max(0, at - 1), at)) && !/\w/.test(script[at - 2] ?? '')
      at++
      while (at < n) {
        if (escaped && script[at] === '\\') at += 2
        else if (script[at] === "'" && script[at + 1] === "'") at += 2
        else if (script[at] === "'") break
        else at++
      }
      at++
    } else if (c === '"') {
      at++
      while (at < n && !(script[at] === '"' && script[at + 1] !== '"'))
        at += script[at] === '"' ? 2 : 1
      at++
    } else if (c === '$' && !/\w/.test(script[at - 1] ?? '')) {
      const tag = /^\$([A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/.exec(script.slice(at))
      if (tag) at = skipTo(tag[0], at + tag[0].length)
      else at++
    } else if (c === ';') {
      out.push(script.slice(start, at))
      at++
      start = at
    } else at++
  }
  out.push(script.slice(start))
  return out
    .map((s) => s.trim())
    .filter((s) => s && !/^(--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/|\s)*$/.test(s))
}
