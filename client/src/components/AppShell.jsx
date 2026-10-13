import {
  BarChart3,
  ClipboardCheck,
  FileStack,
  FolderKanban,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Star,
  Trophy,
  UserCog,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useToast } from '../context/contexts.js'
import { roleLabel } from '../lib/format.js'
import { Badge } from './ui.jsx'

const NAV = [
  {
    heading: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/projects', label: 'Projects', icon: FolderKanban },
      { to: '/leaderboard', label: 'Leaderboards', icon: Trophy },
    ],
  },
  {
    heading: 'My work',
    roles: ['student', 'faculty'],
    items: [
      { to: '/my-projects', label: 'My submissions', icon: FileStack, roles: ['student'] },
      { to: '/my-ratings', label: 'My ratings', icon: Star },
    ],
  },
  {
    heading: 'Administration',
    roles: ['admin'],
    items: [
      { to: '/admin/projects', label: 'Project review', icon: ClipboardCheck },
      { to: '/admin/attendance', label: 'Attendance', icon: Users },
      { to: '/admin/users', label: 'Students & faculty', icon: UserCog },
      { to: '/admin/reports', label: 'Voting reports', icon: BarChart3 },
      { to: '/admin/settings', label: 'Event settings', icon: Settings },
      { to: '/admin/activity', label: 'Activity log', icon: History },
    ],
  },
]

function Brand() {
  return (
    <Link to="/dashboard" className="flex items-center gap-2.5">
      <img src="/logo.svg" alt="" className="size-9" />
      <div className="leading-tight">
        <p className="font-display text-lg font-bold text-white">ProjectEval</p>
        <p className="text-[11px] uppercase tracking-wider text-brand-200">Evaluation &amp; Voting</p>
      </div>
    </Link>
  )
}

function Navigation({ role, onNavigate }) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-6" aria-label="Main">
      {NAV.filter((section) => !section.roles || section.roles.includes(role)).map((section) => (
        <div key={section.heading}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-brand-300">{section.heading}</p>
          <ul className="space-y-0.5">
            {section.items
              .filter((item) => !item.roles || item.roles.includes(role))
              .map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive ? 'bg-white/10 text-white' : 'text-brand-100 hover:bg-white/5 hover:text-white'
                      }`
                    }
                  >
                    <Icon className="size-4.5" aria-hidden />
                    {label}
                  </NavLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function UserPanel({ user, onLogout, onNavigate }) {
  return (
    <div className="border-t border-white/10 p-3">
      <NavLink
        to="/account"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-brand-100 transition hover:bg-white/5"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-brand-950">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{user.name}</span>
          <span className="block text-xs text-brand-200">{roleLabel[user.role]}</span>
        </span>
        <UserRound className="size-4" aria-hidden />
      </NavLink>
      <button
        type="button"
        onClick={onLogout}
        className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-brand-100 transition hover:bg-white/5 hover:text-white"
      >
        <LogOut className="size-4.5" aria-hidden />
        Sign out
      </button>
    </div>
  )
}

function EligibilityPill({ user, eligibility }) {
  if (user.role === 'admin' || !eligibility) return null
  return eligibility.eligible ? (
    <Badge tone="success">● Eligible to vote</Badge>
  ) : (
    <Badge tone="warning" className="max-w-[16rem] truncate">
      Voting locked
    </Badge>
  )
}

export function AppShell() {
  const { user, eligibility, settings, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [openPath, setOpenPath] = useState(null)
  // The mobile drawer closes itself whenever the route changes.
  const mobileOpen = openPath === location.pathname

  const handleLogout = async () => {
    await logout()
    toast.info('You have been signed out.')
    navigate('/login', { replace: true })
  }

  const sidebar = (onNavigate) => (
    <>
      <div className="flex h-16 items-center px-5">
        <Brand />
      </div>
      <Navigation role={user.role} onNavigate={onNavigate} />
      <UserPanel user={user} onLogout={handleLogout} onNavigate={onNavigate} />
    </>
  )

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-900 lg:flex">{sidebar()}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpenPath(null)} aria-hidden />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-brand-900 shadow-xl">
            <button
              type="button"
              onClick={() => setOpenPath(null)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-brand-100 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            {sidebar(() => setOpenPath(null))}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setOpenPath(location.pathname)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{settings?.eventName ?? 'ProjectEval'}</p>
            <p className="hidden text-xs text-slate-500 sm:block">
              {settings?.votingOpen ? 'Voting is open' : 'Voting is closed'}
              {settings?.activeSession && ` · Session ${settings.activeSession}`}
            </p>
          </div>
          <EligibilityPill user={user} eligibility={eligibility} />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
