/**
 * The page's policy allows no script made from text, and the manifest's schemas are zod's,
 * which would try one to learn whether it may compile its parsers. The attempt is caught,
 * but the browser reports it all the same. This says beforehand not to try.
 *
 * It is imported for what it does, before the schemas are made: a schema asks as it is built.
 */
import { z } from 'zod'

z.config({ jitless: true })
