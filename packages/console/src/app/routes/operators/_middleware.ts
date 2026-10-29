import { createRoute } from 'honox/factory'
import { requireOperator } from '../../middleware/guards'

/** The administration is for the operators Access names. */
export default createRoute(requireOperator)
