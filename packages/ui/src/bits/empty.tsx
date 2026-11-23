import { Empty } from './page.tsx'

/** The saying of a collection the reader may not reach: it is the same wherever it is met. */
export const NoCollection = ({ name }: { name?: string }) => (
  <Empty>
    {name
      ? `There is no collection ${name} here that you may reach.`
      : 'No collection here that you may reach.'}
  </Empty>
)
