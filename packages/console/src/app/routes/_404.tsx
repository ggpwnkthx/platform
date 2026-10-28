import type { NotFoundHandler } from 'hono'
import { PageHead } from '../components/page'

const handler: NotFoundHandler = (c) => {
  c.status(404)
  return c.render(
    <section class="refusal">
      <PageHead
        eyebrow="404"
        title="Page not found"
        lede="Nothing lives at this address. It may be mistyped, or what it pointed to may be gone."
      />
      <p class="row">
        <a class="button" href="/">
          Go to the overview
        </a>
        <a class="button quiet" href="/docs">
          Documentation
        </a>
      </p>
    </section>,
    { title: 'Not found' }
  )
}

export default handler
