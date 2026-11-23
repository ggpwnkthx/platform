import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import 'mantine-datatable/styles.css'
import './styles.css'
import { Center, createTheme, Loader, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Grants } from './access/grants.tsx'
import { Policies } from './access/policies-page.tsx'
import { RoleDetail } from './access/role-detail.tsx'
import { Roles } from './access/roles.tsx'
import { Activity } from './activity/activity.tsx'
import { Sql } from './activity/sql.tsx'
import { pages } from './config.ts'
import { ContentHome } from './content/home.tsx'
import { Item } from './content/item.tsx'
import { Records } from './content/records.tsx'
import { CollectionModel } from './model/collection.tsx'
import { ModelHome } from './model/home.tsx'
import { NewCollection } from './model/new.tsx'
import { useGate } from './session/context.ts'
import { SessionProvider } from './session/provider.tsx'
import { Shell } from './shell/shell.tsx'
import { SignIn } from './shell/signin.tsx'
import { NewWorkspace, WorkspaceSettings } from './workspace.tsx'

/** The design system as a theme: one orange for action and selection, Inter for the studio's words, JetBrains Mono for the database's. */
const theme = createTheme({
  primaryColor: 'orange',
  primaryShade: 6,
  autoContrast: true,
  luminanceThreshold: 0.35,
  black: '#1f1f1f',
  colors: {
    orange: [
      '#fdeee9',
      '#f9e0d9',
      '#f7cabc',
      '#f3ab95',
      '#ee8a6a',
      '#f0714a',
      '#f15a2b',
      '#e05428',
      '#ad401e',
      '#7c2e15',
    ],
  },
  fontFamily:
    "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  fontSizes: { xs: '12.5px', sm: '13px', md: '14px' },
  defaultRadius: 6,
  radius: { sm: '6px', md: '10px' },
  headings: { fontWeight: '650' },
})

const routes: Record<keyof typeof pages, () => React.ReactNode> = {
  '/': () => <Navigate to="/content" replace />,
  '/content': ContentHome,
  '/content/records': Records,
  '/content/item': Item,
  '/model': ModelHome,
  '/model/collection': CollectionModel,
  '/model/new': NewCollection,
  '/workspace/new': NewWorkspace,
  '/workspace/settings': WorkspaceSettings,
  '/access': Roles,
  '/access/role': RoleDetail,
  '/access/grants': Grants,
  '/access/policies': Policies,
  '/activity': Activity,
  '/sql': Sql,
}

function App() {
  const { phase } = useGate()
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = `${pages[pathname.replace(/\/+$/, '') as keyof typeof pages] ?? 'Sign in'} · Platform`
  }, [pathname])
  if (phase === 'starting')
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    )
  if (phase !== 'ready') return <SignIn />
  return (
    <Shell>
      <Routes>
        {Object.entries(routes).map(([path, Page]) => (
          <Route key={path} path={path} element={<Page />} />
        ))}
        <Route path="*" element={<Navigate to="/content" replace />} />
      </Routes>
    </Shell>
  )
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})
createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme}>
    <Notifications position="bottom-right" />
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </MantineProvider>
)
