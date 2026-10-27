import { createRoute } from 'honox/factory'
import { requestContext, sameOrigin, securityHeaders, sessionCookie } from '../middleware/requests'

export default createRoute(requestContext, securityHeaders, sameOrigin, sessionCookie)
