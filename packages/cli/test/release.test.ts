import { describe, expect, test } from 'bun:test'
import { digestOf, tagOf } from '../src/platform/registry'
import { latestTagOf, releaseOf } from '../src/platform/release'

/**
 * The release of the platform.
 *
 * A release carries the digest of every image it published, and the
 * wizard of a deployment reads that release instead of the operator
 * copying a digest by hand. The tests prove that the release is read,
 * that a release that is not there is refused, and that the digest of
 * an image of somebody else is read from the registry that holds it.
 */

/** The fetch of the tests, and the answers it gives. */
type Answers = { status: number; body?: unknown; headers?: Record<string, string> }

const real = globalThis.fetch

/**
 * Answers with the answers of the tests.
 *
 * @param answers the answers, by the url of the request.
 */
function answering(answers: Record<string, Answers>): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const answer = answers[url]
    if (!answer) return new Response('not found', { status: 404 })
    return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json', ...(answer.headers ?? {}) },
    })
  }) as typeof globalThis.fetch
}

describe('the release of the platform', () => {
  test('the digests of the release are read', async () => {
    const url = 'https://github.com/ggpwnkthx/platform/releases/download/v1.2.3/digests.json'
    globalThis.fetch = answering({
      [url]: {
        status: 200,
        body: {
          version: '1.2.3',
          tag: 'v1.2.3',
          registry: 'ghcr.io/ggpwnkthx',
          images: {
            gateway: `ghcr.io/ggpwnkthx/gateway@sha256:${'1'.repeat(64)}`,
            access: `ghcr.io/ggpwnkthx/access@sha256:${'2'.repeat(64)}`,
            data: `ghcr.io/ggpwnkthx/data@sha256:${'3'.repeat(64)}`,
            console: `ghcr.io/ggpwnkthx/console@sha256:${'4'.repeat(64)}`,
          },
        },
      },
    })
    try {
      const release = await releaseOf('1.2.3')
      expect(release.version).toBe('1.2.3')
      expect(release.tag).toBe('v1.2.3')
      expect(release.images.gateway_image).toBe(
        `ghcr.io/ggpwnkthx/gateway@sha256:${'1'.repeat(64)}`
      )
      expect(release.images.console_image).toBe(
        `ghcr.io/ggpwnkthx/console@sha256:${'4'.repeat(64)}`
      )
    } finally {
      globalThis.fetch = real
    }
  })

  test('the latest release is read from the repository', async () => {
    globalThis.fetch = answering({
      'https://api.github.com/repos/ggpwnkthx/platform/releases/latest': {
        status: 200,
        body: { tag_name: 'v1.2.3' },
      },
    })
    try {
      expect(await latestTagOf()).toBe('v1.2.3')
    } finally {
      globalThis.fetch = real
    }
  })

  test('the latest release names the digests of its images', async () => {
    const digest = `sha256:${'7'.repeat(64)}`
    globalThis.fetch = answering({
      'https://api.github.com/repos/ggpwnkthx/platform/releases/latest': {
        status: 200,
        body: { tag_name: 'v1.2.3' },
      },
      'https://github.com/ggpwnkthx/platform/releases/download/v1.2.3/digests.json': {
        status: 200,
        body: {
          version: '1.2.3',
          tag: 'v1.2.3',
          images: { gateway: `ghcr.io/ggpwnkthx/gateway@${digest}` },
        },
      },
    })
    try {
      const release = await releaseOf('latest')
      expect(release.tag).toBe('v1.2.3')
      expect(release.images.gateway_image).toBe(`ghcr.io/ggpwnkthx/gateway@${digest}`)
    } finally {
      globalThis.fetch = real
    }
  })

  test('the version of a release is read with or without its tag', async () => {
    const digest = `sha256:${'8'.repeat(64)}`
    globalThis.fetch = answering({
      'https://github.com/ggpwnkthx/platform/releases/download/v1.2.3/digests.json': {
        status: 200,
        body: {
          version: '1.2.3',
          tag: 'v1.2.3',
          images: { gateway: `ghcr.io/ggpwnkthx/gateway@${digest}` },
        },
      },
    })
    try {
      expect((await releaseOf('1.2.3')).tag).toBe('v1.2.3')
      expect((await releaseOf('v1.2.3')).tag).toBe('v1.2.3')
    } finally {
      globalThis.fetch = real
    }
  })

  test('a release that is not there is refused', async () => {
    globalThis.fetch = answering({})
    try {
      await expect(releaseOf('9.9.9')).rejects.toThrow(
        'the release 9.9.9 of the platform is not there'
      )
    } finally {
      globalThis.fetch = real
    }
  })

  test('a release that holds no images is refused', async () => {
    const url = 'https://github.com/ggpwnkthx/platform/releases/download/v1.2.3/digests.json'
    globalThis.fetch = answering({ [url]: { status: 200, body: { version: '1.2.3' } } })
    try {
      await expect(releaseOf('1.2.3')).rejects.toThrow(
        'the release 1.2.3 of the platform does not hold its images'
      )
    } finally {
      globalThis.fetch = real
    }
  })
})

describe('the digests of a registry', () => {
  test('the tag of a reference is read', () => {
    expect(tagOf('postgres:18-alpine@sha256:0000')).toBe('18-alpine')
    expect(tagOf('postgres@sha256:0000')).toBeUndefined()
    expect(tagOf('library/postgres:18-alpine')).toBe('18-alpine')
  })

  test('the digest of an image is read from the registry', async () => {
    const digest = `sha256:${'a'.repeat(64)}`
    globalThis.fetch = answering({
      'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/postgres:pull':
        {
          status: 200,
          body: { token: 'the-token' },
        },
      'https://registry-1.docker.io/v2/library/postgres/manifests/18-alpine': {
        status: 200,
        body: {},
        headers: { 'docker-content-digest': digest },
      },
    })
    try {
      expect(await digestOf('library/postgres', '18-alpine')).toBe(digest)
    } finally {
      globalThis.fetch = real
    }
  })

  test('a registry that does not answer a digest is refused', async () => {
    globalThis.fetch = answering({
      'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/postgres:pull':
        {
          status: 200,
          body: { token: 'the-token' },
        },
      'https://registry-1.docker.io/v2/library/postgres/manifests/18-alpine': {
        status: 200,
        body: {},
      },
    })
    try {
      await expect(digestOf('library/postgres', '18-alpine')).rejects.toThrow('is not a digest')
    } finally {
      globalThis.fetch = real
    }
  })
})
