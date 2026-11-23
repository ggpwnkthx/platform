import { Page } from '../bits/page.tsx'
import { usePlace } from '../session/hooks.ts'
import { useNames } from '../shell/names.ts'
import { PolicyCards } from './policies.tsx'

export function Policies() {
  const place = usePlace()
  const names = useNames()
  return (
    <Page title="Row policies" crumbs={['Access', names(place.ws).name]}>
      <PolicyCards schema={place.ws} />
    </Page>
  )
}
