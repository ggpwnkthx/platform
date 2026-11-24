import { CssBaseline } from '@mui/material'
import { labelColumn } from '@platform/core'
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Admin, CustomRoutes, Loading, memoryStore, Resource } from 'react-admin'
import { Navigate, Route } from 'react-router-dom'
import { dataProvider } from './data/provider.ts'
import { Frame } from './kit/Frame.tsx'
import { useWorkspace } from './kit/place.ts'
import { CollectionModel, WorkspaceModel } from './model/pages.tsx'
import { Activity } from './pages/Activity.tsx'
import { Sql } from './pages/Sql.tsx'
import { RoleList, RolePage } from './access/pages.tsx'
import { RecordCreate, RecordEdit } from './records/Edit.tsx'
import { RecordList } from './records/List.tsx'
import { authProvider, start, useSigned } from './session/session.ts'
import { SignIn } from './session/SignIn.tsx'
import { theme } from './theme.ts'

/** Where the interface opens: the workspace in view. */
function Home() {
  const workspace = useWorkspace()
  return workspace ? <Navigate to={`/w/${workspace.name}`} replace /> : <Loading />
}

/**
 * The interface: react-admin over the reader's own PostgreSQL login. Every collection the
 * catalog shows the reader is a resource — one list, one form — and everything else is a
 * page of sections. Nothing is kept outside memory: the store is memory's, and the address
 * is a hash, so the one document serves every page.
 */
function App() {
  const signed = useSigned()
  return (
    <Admin
      dataProvider={dataProvider}
      authProvider={authProvider}
      loginPage={SignIn}
      layout={Frame}
      theme={theme}
      darkTheme={null}
      store={memoryStore()}
      dashboard={Home}
      title="Platform"
      requireAuth
      disableTelemetry
    >
      {(signed?.catalog.tables ?? []).map((table) => (
        <Resource
          key={`${table.schema}.${table.name}`}
          name={`${table.schema}.${table.name}`}
          list={RecordList}
          edit={RecordEdit}
          create={RecordCreate}
          recordRepresentation={labelColumn(signed!.catalog, table.schema, table.name) ?? 'id'}
        />
      ))}
      <CustomRoutes>
        <Route path="/w/:ws" element={<WorkspaceModel />} />
        <Route path="/w/:ws/:table" element={<CollectionModel />} />
        <Route path="/roles" element={<RoleList />} />
        <Route path="/roles/:role" element={<RolePage />} />
        <Route path="/activity/:ws" element={<Activity />} />
        <Route path="/sql" element={<Sql />} />
      </CustomRoutes>
    </Admin>
  )
}

await start()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CssBaseline />
    <Suspense>
      <App />
    </Suspense>
  </StrictMode>
)
