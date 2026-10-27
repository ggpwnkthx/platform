/**
 * The script of the browser: it hydrates the islands of the page.
 *
 * Every page of the console is rendered on the server; the islands are
 * the parts of a page that live in the browser once it is there.
 */

import { createClient } from 'honox/client'

createClient({
  ISLAND_FILES: import.meta.glob('/src/app/islands/**/*.tsx'),
})
