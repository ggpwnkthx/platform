#!/usr/bin/env bun
/**
 * The shadow comparison (docs/access/operations.md, "Shadow comparison").
 *
 * The tool asks Access of the tree and Access that is in
 * production the same decisions, and it reports the answers that differ. It reads the
 * decisions of the old service and it asks Access: it never writes in Access.
 *
 * The requests are read from a file, one json per line:
 *
 *   {"subject":"…","workspaceId":"…","routeId":"…","roles":[]}
 *
 *   OLD_ACCESS_URL=https://old-access.example.com \\
 *   OLD_ACCESS_TOKEN=… \\
 *   ACCESS_URL=https://access.example.com \\
 *   ACCESS_DECISION_TOKEN=… \\
 *   bun run scripts/shadow.ts --requests decisions.jsonl
 */
import { createHash } from 'node:crypto'
import { readOption } from '../support/options'
import { failure } from '../support/report'

/** The file of the requests. */
const file = readOption('requests') ?? 'decisions.jsonl'

/** Reads an option of the command line. */
/** A decision of the contract of the gateway. */
interface Decision {
  allow: boolean
  reason: string
}

/** Asks Access for a decision. */
async function ask(
  baseUrl: string,
  token: string,
  request: Record<string, unknown>
): Promise<Decision | null> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/decisions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    })
    if (!response.ok) return null
    return (await response.json()) as Decision
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const oldUrl = process.env.OLD_ACCESS_URL
  const oldToken = process.env.OLD_ACCESS_TOKEN ?? ''
  const accessUrl = process.env.ACCESS_URL
  const accessToken = process.env.ACCESS_DECISION_TOKEN ?? ''
  if (!oldUrl || !accessUrl) {
    throw new Error(
      'the comparison needs the two Access instances: OLD_ACCESS_URL and ACCESS_URL must be set'
    )
  }

  const content = await Bun.file(file).text()
  const requests = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

  let compared = 0
  let different = 0
  const differences: {
    subject: string
    workspaceId: string
    old: Decision | null
    access: Decision | null
  }[] = []

  for (const request of requests) {
    const [old, access] = await Promise.all([
      ask(oldUrl, oldToken, request),
      ask(accessUrl, accessToken, request),
    ])
    compared += 1
    if (!old || !access) {
      different += 1
      differences.push({
        subject: String(request.subject),
        workspaceId: String(request.workspaceId ?? ''),
        old,
        access,
      })
      continue
    }
    if (old.allow !== access.allow) {
      different += 1
      differences.push({
        subject: String(request.subject),
        workspaceId: String(request.workspaceId ?? ''),
        old,
        access,
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        level: 'info',
        msg: 'the shadow comparison is over',
        compared,
        different,
        // The fingerprint of the set of the differences: the same
        // difference on every day is the same difference.
        fingerprint: createHash('sha256')
          .update(JSON.stringify(differences))
          .digest('hex')
          .slice(0, 16),
      },
      null,
      2
    )
  )
  for (const difference of differences.slice(0, 20)) {
    console.log(
      JSON.stringify({
        level: 'warn',
        msg: 'the answers differ',
        subject: difference.subject,
        workspaceId: difference.workspaceId,
        old: difference.old,
        access: difference.access,
      })
    )
  }
  // The shadow period does not end before the difference is empty.
  if (different > 0) process.exit(1)
}

main().catch(failure('the comparison failed'))
