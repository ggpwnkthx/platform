import { hydrate } from 'preact-iso'
import { App } from './app.tsx'

const root = document.getElementById('root')
if (root) hydrate(<App />, root)
