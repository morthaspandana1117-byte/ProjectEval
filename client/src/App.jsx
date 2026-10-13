import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell.jsx'
import { GuestOnly, RequireAuth } from './components/RouteGuards.jsx'
import { PageLoader } from './components/ui.jsx'
import { useAuth } from './context/contexts.js'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import NotFound from './pages/NotFound.jsx'
import Register from './pages/Register.jsx'

const MemberDashboard = lazy(() => import('./pages/MemberDashboard.jsx'))
const Projects = lazy(() => import('./pages/Projects.jsx'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.jsx'))
const ProjectForm = lazy(() => import('./pages/ProjectForm.jsx'))
const MyProjects = lazy(() => import('./pages/MyProjects.jsx'))
const MyRatings = lazy(() => import('./pages/MyRatings.jsx'))
const Leaderboard = lazy(() => import('./pages/Leaderboard.jsx'))
const Account = lazy(() => import('./pages/Account.jsx'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'))
const AdminProjects = lazy(() => import('./pages/admin/AdminProjects.jsx'))
const Attendance = lazy(() => import('./pages/admin/Attendance.jsx'))
const Accounts = lazy(() => import('./pages/admin/Accounts.jsx'))
const Reports = lazy(() => import('./pages/admin/Reports.jsx'))
const EventSettings = lazy(() => import('./pages/admin/EventSettings.jsx'))
const ActivityLog = lazy(() => import('./pages/admin/ActivityLog.jsx'))

function Dashboard() {
  const { user } = useAuth()
  return user.role === 'admin' ? <AdminDashboard /> : <MemberDashboard />
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<GuestOnly />}>
          <Route index element={<Landing />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="account" element={<Account />} />

            <Route element={<RequireAuth roles={['student']} />}>
              <Route path="my-projects" element={<MyProjects />} />
              <Route path="my-projects/new" element={<ProjectForm />} />
            </Route>
            <Route element={<RequireAuth roles={['student', 'admin']} />}>
              <Route path="projects/:id/edit" element={<ProjectForm />} />
            </Route>
            <Route element={<RequireAuth roles={['student', 'faculty']} />}>
              <Route path="my-ratings" element={<MyRatings />} />
            </Route>

            <Route path="admin" element={<RequireAuth roles={['admin']} />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="projects" element={<AdminProjects />} />
              <Route path="attendance" element={<Attendance />} />
              <Route path="users" element={<Accounts />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<EventSettings />} />
              <Route path="activity" element={<ActivityLog />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
