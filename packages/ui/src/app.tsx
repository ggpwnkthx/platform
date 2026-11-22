// The installation's own field types and renderers, added before any page draws a field.
import './extensions.ts'
import { useEffect } from 'preact/hooks'
import { LocationProvider, Route, Router, useLocation } from 'preact-iso'
import { pageOf, titleAt } from './routes.ts'
import { SessionProvider, useSession } from './session.tsx'
import { Shell } from './shell.tsx'

import { Toasts } from './ui/toasts.tsx'
import { Policies } from './access/policies/policies.tsx'
import { RoleDetail } from './access/roles/detail.tsx'
import { Roles } from './access/roles/roles.tsx'
import { Grants } from './access/workspaces/access.tsx'
import { Activity } from './activity/activity.tsx'
import { ContentHome } from './content/content.tsx'
import { Item } from './content/item/item.tsx'
import { CollectionModel } from './model/collection/page.tsx'
import { ModelHome } from './model/home.tsx'
import { NewCollection } from './model/new.tsx'
import { Records } from './content/records/records.tsx'
import { SignIn } from './identity/signin.tsx'
import { Sql } from './sql/sql.tsx'
import { NewWorkspace, WorkspaceSettings } from './workspace/workspace.tsx'

function NotFound() {
  return <SignIn />
}

function Signed() {
  const { phase } = useSession()
  const { path } = useLocation()
  const page = pageOf(path)
  // The generated file titles the page it is; a link inside the app loads no file.
  useEffect(() => {
    document.title = titleAt(path, document.title)
  }, [path])
  // Every page starts signed out: the token lives in memory, so the generated HTML is the
  // sign-in, and the page itself appears once the database has let the reader in.
  if (phase !== 'ready' || !page || page.path === '/') return <SignIn />
  return (
    <Shell module={page.module === 'workspace' ? 'content' : page.module}>
      <Router>
        <Route path="/content" component={ContentHome} />
        <Route path="/content/records" component={Records} />
        <Route path="/content/item" component={Item} />
        <Route path="/model" component={ModelHome} />
        <Route path="/model/collection" component={CollectionModel} />
        <Route path="/model/new" component={NewCollection} />
        <Route path="/workspace/new" component={NewWorkspace} />
        <Route path="/workspace/settings" component={WorkspaceSettings} />
        <Route path="/access" component={Roles} />
        <Route path="/access/role" component={RoleDetail} />
        <Route path="/access/grants" component={Grants} />
        <Route path="/access/policies" component={Policies} />
        <Route path="/activity" component={Activity} />
        <Route path="/sql" component={Sql} />
        <Route default component={NotFound} />
      </Router>
    </Shell>
  )
}

export function App() {
  return (
    <LocationProvider>
      <SessionProvider>
        <Signed />
        <Toasts />
      </SessionProvider>
    </LocationProvider>
  )
}
