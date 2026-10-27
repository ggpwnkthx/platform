/**
 * The end of a session. The access service has no session of its own to
 * end: the token of the caller expires with its five minutes.
 */

import { createRoute } from 'honox/factory'
import { clearSessionCookie } from '../../middleware/session'

export const POST = createRoute((c) => {
  const session = c.get('session')
  if (session) c.get('services').sessions.destroy(session.id)
  c.set('session', null)
  clearSessionCookie(c)
  return c.redirect('/')
})

export default createRoute((c) => c.redirect('/'))
