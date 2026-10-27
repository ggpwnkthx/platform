import { createRoute } from 'honox/factory'
import { requireToken } from '../../middleware/guards'

/** The pages of the data need a caller whose token the gateway accepts. */
export default createRoute(requireToken)
