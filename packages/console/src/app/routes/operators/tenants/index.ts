import { createRoute } from 'honox/factory'

/** The tenants are listed by the page of the administration. */
export default createRoute((c) => c.redirect('/operators'))
