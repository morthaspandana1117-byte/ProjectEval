import { ArrowRight, CheckCircle2, FileStack, FolderKanban, Lock, Plus, Star, Trophy } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { DeadlineList, TimezoneNote } from '../components/DeadlineStatus.jsx'
import { Alert, Button, Card, CardHeader, EmptyState, ErrorState, ProgressBar, Skeleton, StatCard, StatusBadge } from '../components/ui.jsx'
import { useAuth } from '../context/contexts.js'
import { useAsync } from '../hooks/useAsync.js'
import { api } from '../lib/api.js'
import { formatSession } from '../lib/format.js'

async function loadDashboard(role) {
  const [projects, ratings, mine] = await Promise.all([
    api.get('/projects', { params: { limit: 100 } }),
    api.get('/ratings/mine'),
    role === 'student' ? api.get('/projects/mine') : Promise.resolve({ data: { projects: [] } }),
  ])
  const rateable = projects.data.projects.filter((p) => !p.isOwn)
  return {
    approvedTotal: projects.data.pagination.total,
    rateableTotal: rateable.length,
    rated: ratings.data.ratings.length,
    recentRatings: ratings.data.ratings.slice(0, 4),
    unrated: rateable.filter((p) => !p.myScore).slice(0, 4),
    mine: mine.data.projects,
  }
}

function EligibilityCard({ user, eligibility, settings }) {
  if (!eligibility) return null
  if (eligibility.eligible) {
    return (
      <Alert tone="success" title="You are eligible to vote">
        {user.role === 'faculty'
          ? 'Faculty members can rate every approved project while voting is open.'
          : `You are marked present for ${formatSession(settings?.activeSession)}. Rate projects and share what you understood.`}
      </Alert>
    )
  }
  return (
    <Alert tone="warning" title="Voting is locked for you right now">
      {eligibility.reason}
    </Alert>
  )
}

export default function MemberDashboard() {
  const { user, eligibility, settings, deadlines, refresh } = useAuth()
  // Server-computed: manual switch AND submission deadline.
  const submissionOpen = Boolean(deadlines?.submission.open)
  const { data, error, loading, reload } = useAsync(() => loadDashboard(user.role), [user.role])

  // Pick up attendance or voting changes made by the administrator since sign-in.
  useEffect(() => {
    refresh()
  }, [refresh])

  const progress = data?.rateableTotal ? (data.rated / data.rateableTotal) * 100 : 0

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-amber-600">
          {user.role === 'faculty' ? 'Faculty dashboard' : 'Student dashboard'}
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">Hello, {user.name.split(' ')[0]}</h1>
      </div>

      <EligibilityCard user={user} eligibility={eligibility} settings={settings} />

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {loading && !data ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)
            ) : (
              <>
                <StatCard label="Approved projects" value={data.approvedTotal} icon={FolderKanban} />
                <StatCard label="Projects you rated" value={data.rated} icon={Star} tone="amber" />
                <Card className="p-5">
                  <p className="text-sm font-medium text-slate-500">Your progress</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{Math.round(progress)}%</p>
                  <div className="mt-3">
                    <ProgressBar value={progress} tone="emerald" label="Rating progress" />
                  </div>
                </Card>
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Waiting for your rating"
                description="Approved projects you have not rated yet"
                action={
                  <Button as={Link} to="/projects" variant="ghost" size="sm">
                    All projects <ArrowRight className="size-4" aria-hidden />
                  </Button>
                }
              />
              {loading && !data ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : data.unrated.length === 0 ? (
                <EmptyState
                  icon={data.rateableTotal ? CheckCircle2 : FolderKanban}
                  title={data.rateableTotal ? 'All caught up!' : 'No projects to rate yet'}
                  description={
                    data.rateableTotal
                      ? 'You have rated every available project. You can still update your ratings.'
                      : 'Projects appear here once the administrator approves them.'
                  }
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.unrated.map((project) => (
                    <li key={project._id}>
                      <Link to={`/projects/${project._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                        <span className="rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs font-semibold text-brand-700">
                          {project.projectNumber}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{project.title}</span>
                        {eligibility?.eligible ? (
                          <span className="text-xs font-medium text-brand-700">Rate now</span>
                        ) : (
                          <Lock className="size-4 text-slate-400" aria-label="Voting locked" />
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {user.role === 'student' ? (
              <Card>
                <CardHeader
                  title="My submissions"
                  description="Projects you are presenting"
                  action={
                    submissionOpen && (
                      <Button as={Link} to="/my-projects/new" size="sm" icon={Plus}>
                        Submit project
                      </Button>
                    )
                  }
                />
                {loading && !data ? (
                  <div className="p-5">
                    <Skeleton className="h-12" />
                  </div>
                ) : data.mine.length === 0 ? (
                  <EmptyState
                    icon={FileStack}
                    title="No submissions yet"
                    description={
                      submissionOpen
                        ? 'Presenting a project? Submit it for review so others can evaluate it.'
                        : (deadlines?.submission.reason ?? 'Project submissions are currently closed.')
                    }
                  />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.mine.map((project) => (
                      <li key={project._id}>
                        <Link to={`/projects/${project._id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50">
                          <span className="font-mono text-xs font-semibold text-slate-500">{project.projectNumber}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{project.title}</span>
                          <StatusBadge status={project.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {deadlines && (
                  <div className="space-y-3 border-t border-slate-100 px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Presenter deadlines</p>
                    <DeadlineList deadlines={deadlines} compact />
                    <TimezoneNote deadlines={deadlines} />
                  </div>
                )}
              </Card>
            ) : (
              <Card>
                <CardHeader title="Recently rated" description="Your latest evaluations" />
                {loading && !data ? (
                  <div className="p-5">
                    <Skeleton className="h-12" />
                  </div>
                ) : data.recentRatings.length === 0 ? (
                  <EmptyState icon={Star} title="No ratings yet" description="Your ratings will appear here." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.recentRatings.map((rating) => (
                      <li key={rating._id}>
                        <Link to={`/projects/${rating.project._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{rating.project.title}</span>
                          <span className="flex items-center gap-1 text-sm font-semibold text-amber-600">
                            <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden /> {rating.score}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>

          <Card className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-brand-800 to-brand-700 p-6 text-white">
            <div>
              <h2 className="font-display text-xl font-semibold text-white">See how projects are ranking</h2>
              <p className="mt-1 text-sm text-brand-100">Student and faculty leaderboards are calculated independently.</p>
            </div>
            <Button as={Link} to="/leaderboard" variant="accent" icon={Trophy}>
              View leaderboards
            </Button>
          </Card>
        </>
      )}
    </div>
  )
}
