import { createRoute } from 'honox/factory'
import { requireOperator } from '../../middleware/guards'

/** The administration is for the operators the access service names. */
export default createRoute(requireOperator)
