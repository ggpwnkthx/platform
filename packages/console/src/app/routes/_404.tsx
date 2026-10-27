import type { NotFoundHandler } from 'hono'
import { PageHead } from '../components/page'

const handler: NotFoundHandler = (c) => {
  c.status(404)
  return c.render(
    <section class="refusal">
      <PageHead
        title="There is no such page"
        lede="The console has no page at this address. The address may be mistyped, or the thing it named may be gone."
      />
      <p>
        <a class="button quiet" href="/">
          The overview
        </a>
      </p>
    </section>,
    { title: 'Not found' }
  )
}

export default handler
