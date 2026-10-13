import { EyeOff, GraduationCap, Medal, Trophy, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Stars } from '../components/StarRating.jsx'
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui.jsx'
import { useAsync } from '../hooks/useAsync.js'
import { api } from '../lib/api.js'
import { formatRating } from '../lib/format.js'

const BOARDS = {
  student: {
    label: 'Student Voting',
    title: 'Student Voting Leaderboard',
    icon: Users,
    description: 'Ranked by the average of student ratings only.',
    empty: 'No project has received a student rating yet.',
  },
  faculty: {
    label: 'Faculty Voting',
    title: 'Faculty Voting Leaderboard',
    icon: GraduationCap,
    description: 'Ranked by the average of faculty ratings only.',
    empty: 'No project has received a faculty rating yet.',
  },
  overall: {
    label: 'Overall',
    title: 'Overall Project Leaderboard',
    icon: Trophy,
    description: 'Ranked by the average of all student and faculty ratings combined, each rating counted equally.',
    empty: 'No project has been rated yet.',
  },
}

const MEDALS = {
  1: 'bg-amber-100 text-amber-700 ring-amber-300',
  2: 'bg-slate-100 text-slate-600 ring-slate-300',
  3: 'bg-orange-100 text-orange-700 ring-orange-300',
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function RankBadge({ rank }) {
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ${MEDALS[rank] ?? 'bg-white text-slate-700 ring-slate-200'}`}
      aria-label={`Rank ${rank}`}
    >
      {rank <= 3 ? <Medal className="size-4" aria-hidden /> : rank}
    </span>
  )
}

function Distribution({ distribution, total }) {
  return (
    <div className="flex h-8 w-24 items-end gap-0.5" aria-label="Score distribution from 1 to 5 stars">
      {distribution.map((count, i) => (
        <div
          key={i}
          title={`${i + 1}★: ${count}`}
          className="flex-1 rounded-sm bg-amber-300"
          style={{ height: `${total ? Math.max(8, (count / total) * 100) : 8}%`, opacity: count ? 1 : 0.25 }}
        />
      ))}
    </div>
  )
}

function CountLine({ entry, group }) {
  if (group !== 'overall') return <p className="text-xs text-slate-500">{plural(entry.voteCount, 'rating')}</p>
  return (
    <>
      <p className="text-xs font-medium text-slate-600">{plural(entry.voteCount, 'rating')} total</p>
      <p className="text-[11px] text-slate-400">
        {entry.studentVoteCount} student · {entry.facultyVoteCount} faculty
      </p>
    </>
  )
}

export default function Leaderboard() {
  const [group, setGroup] = useState('student')
  const board = BOARDS[group]
  const { data, error, loading, reload } = useAsync(
    () => api.get('/leaderboard', { params: { group } }).then((r) => r.data.entries),
    [group],
  )
  const hidden = error?.response?.status === 403

  return (
    <div>
      <PageHeader
        eyebrow="Results"
        title="Leaderboards"
        description="Three independent rankings. Projects without ratings in a category are not listed in that leaderboard; equal averages are ordered by project name."
      />
      <Tabs
        className="mb-6"
        value={group}
        onChange={setGroup}
        tabs={Object.entries(BOARDS).map(([value, { label, icon }]) => ({ value, label, icon }))}
      />

      <Card>
        <CardHeader title={board.title} description={board.description} />
        {hidden ? (
          <EmptyState icon={EyeOff} title="Results are not published yet" description="The administrator will publish the leaderboards after evaluation." />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon={board.icon} title="No ranked projects yet" description={board.empty} />
        ) : (
          <ol className="divide-y divide-slate-100">
            {data.map((entry) => (
              <li key={entry.project._id} className={`flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5 ${entry.rank === 1 ? 'bg-amber-50/50' : ''}`}>
                <RankBadge rank={entry.rank} />
                <div className="min-w-0 flex-1 basis-48">
                  <Link to={`/projects/${entry.project._id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                    {entry.project.title}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    <span className="font-mono">{entry.project.projectNumber}</span>
                    {entry.project.facultyGuide && ` · Guide: ${entry.project.facultyGuide}`} · {plural(entry.project.teamSize, 'member')}
                  </p>
                </div>
                <div className="hidden sm:block">
                  <Distribution distribution={entry.distribution} total={entry.voteCount} />
                </div>
                <div className="w-36 text-right">
                  <p className="text-xl font-bold tabular-nums text-slate-900">
                    {formatRating(entry.averageRating)}
                    <span className="text-sm font-medium text-slate-400"> / 5</span>
                  </p>
                  <div className="flex justify-end">
                    <Stars value={entry.averageRating} className="size-3.5" />
                  </div>
                  <CountLine entry={entry} group={group} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}
