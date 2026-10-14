import { ArrowRight, ClipboardCheck, FolderKanban, GraduationCap, History, Star, UserCheck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatCard,
} from '../../components/ui.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { api } from '../../lib/api.js'
import { formatDateTime, formatSession } from '../../lib/format.js'

function Meter({ label, part, whole, rate, tone }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500">
          <span className="font-semibold text-slate-900">{rate}%</span> · {part} of {whole}
        </span>
      </div>
      <ProgressBar value={rate} tone={tone} label={label} />
    </div>
  )
}

// Badge text from the server's deadline summary (manual switch + deadlines).
function submissionLabel(submission) {
  if (!submission.switchOn) return '○ Submissions switched off'
  if (!submission.open) return submission.invalid ? '○ Submissions closed (deadline misconfigured)' : '○ Submission deadline passed'
  return submission.configured ? `● Submissions open until ${submission.display}` : '● Submissions open (no deadline)'
}

function windowLabel(name, window) {
  if (!window.open) return window.invalid ? `○ ${name} closed (deadline misconfigured)` : `○ ${name} closed since ${window.display}`
  return window.configured ? `● ${name} open until ${window.display}` : `● ${name} open (no deadline)`
}

export default function AdminDashboard() {
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/stats').then((r) => r.data), [])

  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={reload} />
      </Card>
    )
  }

  const s = data
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administrator"
        title="Event overview"
        description={s ? `Active session: ${formatSession(s.attendance.session)}` : 'Live participation, attendance and project status.'}
        actions={
          <>
            <Button as={Link} to="/admin/attendance" variant="secondary" icon={UserCheck}>
              Mark attendance
            </Button>
            <Button as={Link} to="/admin/reports" icon={Star}>
              Voting reports
            </Button>
          </>
        }
      />

      {s && (
        <div className="flex flex-wrap gap-2">
          <Badge tone={s.settings.votingOpen ? 'success' : 'neutral'}>{s.settings.votingOpen ? '● Voting open' : '○ Voting closed'}</Badge>
          <Badge tone={s.deadlines.submission.open ? 'success' : 'neutral'}>{submissionLabel(s.deadlines.submission)}</Badge>
          <Badge tone={s.deadlines.edit.open ? 'success' : 'neutral'}>{windowLabel('Editing', s.deadlines.edit)}</Badge>
          <Badge tone={s.deadlines.upload.open ? 'success' : 'neutral'}>{windowLabel('Uploads', s.deadlines.upload)}</Badge>
          <Badge tone={s.settings.leaderboardVisible ? 'brand' : 'neutral'}>
            {s.settings.leaderboardVisible ? 'Leaderboards published' : 'Leaderboards hidden'}
          </Badge>
          <Link to="/admin/settings" className="text-xs font-medium text-brand-700 hover:underline">
            Change settings
          </Link>
        </div>
      )}

      {s && s.projects.pending > 0 && (
        <Alert
          tone="warning"
          title={`${s.projects.pending} project${s.projects.pending > 1 ? 's' : ''} awaiting review`}
          action={
            <Button as={Link} to="/admin/projects" size="sm" variant="secondary">
              Review
            </Button>
          }
        >
          Approve projects to make them visible and open for rating.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !s ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <StatCard label="Active students" value={s.users.students} icon={Users} />
            <StatCard label="Faculty" value={s.users.faculty} icon={GraduationCap} tone="amber" />
            <StatCard
              label="Present this session"
              value={s.attendance.present}
              hint={`${s.attendance.absent} absent · ${s.attendance.unmarked} not marked`}
              icon={UserCheck}
              tone="emerald"
            />
            <StatCard
              label="Ratings submitted"
              value={s.ratings.total}
              hint={`${s.ratings.student} student · ${s.ratings.faculty} faculty`}
              icon={Star}
              tone="amber"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Voting participation" description="Share of each group that has rated at least one project" />
          <div className="space-y-6 p-5">
            {loading && !s ? (
              <>
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </>
            ) : (
              <>
                <Meter label="Attendance (active students present)" part={s.attendance.present} whole={s.users.students} rate={s.attendance.rate} tone="emerald" />
                <Meter label="Present students who voted" part={s.participation.presentVoted} whole={s.attendance.present} rate={s.participation.presentRate} tone="brand" />
                <Meter label="All students who voted" part={s.participation.studentVoters} whole={s.users.students} rate={s.participation.studentRate} tone="brand" />
                <Meter label="Faculty who voted" part={s.participation.facultyVoters} whole={s.users.faculty} rate={s.participation.facultyRate} tone="amber" />
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Projects"
            action={
              <Button as={Link} to="/admin/projects" variant="ghost" size="sm">
                Manage <ArrowRight className="size-4" aria-hidden />
              </Button>
            }
          />
          {loading && !s ? (
            <div className="p-5">
              <Skeleton className="h-32" />
            </div>
          ) : (
            <dl className="divide-y divide-slate-100">
              {[
                ['Approved', s.projects.approved, 'text-emerald-700'],
                ['Pending review', s.projects.pending, 'text-amber-700'],
                ['Changes requested', s.projects.rejected, 'text-rose-700'],
                ['Total submissions', s.projects.total, 'text-slate-900'],
              ].map(([label, value, color]) => (
                <div key={label} className="flex items-center justify-between px-5 py-3">
                  <dt className="flex items-center gap-2 text-sm text-slate-600">
                    <FolderKanban className="size-4 text-slate-400" aria-hidden />
                    {label}
                  </dt>
                  <dd className={`text-lg font-bold tabular-nums ${color}`}>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent activity"
          action={
            <Button as={Link} to="/admin/activity" variant="ghost" size="sm">
              Full log <ArrowRight className="size-4" aria-hidden />
            </Button>
          }
        />
        {loading && !s ? (
          <div className="p-5">
            <Skeleton className="h-24" />
          </div>
        ) : s.recentActivity.length === 0 ? (
          <EmptyState icon={History} title="No activity yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {s.recentActivity.map((log) => (
              <li key={log._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <ClipboardCheck className="size-4 text-slate-400" aria-hidden />
                <span className="font-medium text-slate-800">{log.actor?.name ?? 'System'}</span>
                {/* Full-width line on phones; shares the row on wider screens. */}
                <span className="min-w-0 basis-full text-slate-600 sm:basis-0 sm:flex-1">{log.summary ?? log.action}</span>
                <span className="text-xs text-slate-400">{formatDateTime(log.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
