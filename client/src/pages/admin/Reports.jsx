import { BarChart3, Download, Eye, Search, ShieldCheck, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Stars } from '../../components/StarRating.jsx'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageLoader,
  Select,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
} from '../../components/ui.jsx'
import { ExportDialog } from '../../components/ExportDialog.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js'
import { api } from '../../lib/api.js'
import { formatDateTime, formatRating } from '../../lib/format.js'

function RatingsModal({ project, onClose }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/admin/projects/${project._id}/ratings`).then((r) => r.data), [project._id])
  return (
    <Modal open onClose={onClose} size="lg" title={`${project.projectNumber} — ${project.title}`} description="Confidential: voter identities are visible to administrators only.">
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading ? (
        <PageLoader label="Loading ratings…" />
      ) : data.ratings.length === 0 ? (
        <EmptyState icon={BarChart3} title="No ratings yet" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.ratings.map((rating) => (
            <li key={rating._id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{rating.voter?.name ?? 'Deleted user'}</span>
                <span className="font-mono text-xs text-slate-400">{rating.voter?.rollNumber ?? rating.voter?.employeeId}</span>
                <Badge tone={rating.voterRole === 'faculty' ? 'brand' : 'neutral'}>{rating.voterRole}</Badge>
                <Stars value={rating.score} className="size-3.5" />
                <span className="ml-auto text-xs text-slate-400">{formatDateTime(rating.updatedAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">{rating.feedback}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function GroupCell({ group }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 font-semibold tabular-nums text-slate-900">{formatRating(group.averageRating)}</span>
      <span className="text-xs text-slate-500">({group.voteCount})</span>
    </div>
  )
}

function VotingSummary() {
  const [viewing, setViewing] = useState(null)
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/reports/voting').then((r) => r.data.projects), [])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (loading) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    )
  }
  if (data.length === 0) return <EmptyState icon={BarChart3} title="No approved projects" description="Approve projects to start collecting votes." />

  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Project</Th>
            <Th>Guide</Th>
            <Th>Student avg (votes)</Th>
            <Th>Faculty avg (votes)</Th>
            <Th>Overall avg (total votes)</Th>
            <Th className="text-right">Ratings</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {data.map((project) => (
            <tr key={project._id} className="hover:bg-slate-50/60">
              <Td className="max-w-xs">
                <p className="font-mono text-xs font-semibold text-brand-700">{project.projectNumber}</p>
                <Link to={`/projects/${project._id}`} className="block truncate font-medium text-slate-900 hover:text-brand-700">
                  {project.title}
                </Link>
              </Td>
              <Td>{project.facultyGuide ?? '—'}</Td>
              <Td>
                <GroupCell group={project.student} />
              </Td>
              <Td>
                <GroupCell group={project.faculty} />
              </Td>
              <Td>
                <GroupCell group={project.overall} />
              </Td>
              <Td className="text-right">
                <Button variant="ghost" size="sm" icon={Eye} disabled={!project.totalVotes} onClick={() => setViewing(project)}>
                  View
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {viewing && <RatingsModal project={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}

function Participation() {
  const [role, setRole] = useState('student')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())
  const { data, error, loading, reload } = useAsync(
    () => api.get('/admin/reports/participation', { params: { role, filter, search: debounced || undefined } }).then((r) => r.data),
    [role, filter, debounced],
  )

  return (
    <>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
        <Select aria-label="Group" value={role} onChange={(e) => setRole(e.target.value)} className="w-36">
          <option value="student">Students</option>
          <option value="faculty">Faculty</option>
        </Select>
        <Select aria-label="Voting filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40">
          <option value="all">Everyone</option>
          <option value="voted">Has voted</option>
          <option value="not-voted">Has not voted</option>
        </Select>
        <label className="relative block min-w-[12rem] flex-1">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or ID"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </label>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : data.users.length === 0 ? (
        <EmptyState icon={Users} title="Nobody matches these filters" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>{data.role === 'student' ? 'Roll no.' : 'Employee ID'}</Th>
              {data.role === 'student' && <Th>Attendance ({data.activeSession})</Th>}
              <Th>Projects rated</Th>
              <Th>Last vote</Th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-slate-100 bg-white ${loading ? 'opacity-60' : ''}`}>
            {data.users.map((user) => (
              <tr key={user._id}>
                <Td>
                  <p className="font-medium text-slate-900">{user.name}</p>
                  <p className="text-xs text-slate-400">{user.email}</p>
                </Td>
                <Td className="font-mono text-xs">{user.rollNumber ?? user.employeeId ?? '—'}</Td>
                {data.role === 'student' && (
                  <Td>{user.present ? <Badge tone="success">Present</Badge> : <Badge>Not present</Badge>}</Td>
                )}
                <Td className="font-semibold tabular-nums">{user.votesCast}</Td>
                <Td className="text-xs text-slate-500">{formatDateTime(user.lastVotedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}

const VOTING_LAYOUTS = [
  { value: 'none', label: 'All in one sheet', hint: 'Project Summary plus one Ratings sheet with every rating (original layout).' },
  {
    value: 'year',
    label: 'Group by year',
    hint: 'Project Summary, student ratings split into 1st–4th year sheets (plus higher years and “Unassigned Year” when needed), and faculty ratings on their own sheet.',
  },
]

function describeVotingExport({ groupBy }) {
  const date = new Date().toISOString().slice(0, 10)
  return {
    url: `/admin/reports/voting/export?groupBy=${groupBy}`,
    filename: `voting-report-${date}${groupBy === 'year' ? '-by-year' : ''}.xlsx`,
  }
}

export default function Reports() {
  const [tab, setTab] = useState('summary')
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Voting reports"
        description="Group-wise results, individual ratings and participation."
        actions={
          <Button icon={Download} onClick={() => setExportOpen(true)}>
            Export to Excel
          </Button>
        }
      />
      {exportOpen && (
        <ExportDialog
          open
          onClose={() => setExportOpen(false)}
          title="Export voting report"
          description="Confidential: includes voter names, emails and feedback for every rating."
          initialValues={{ groupBy: 'none' }}
          describe={describeVotingExport}
          fields={[{ name: 'groupBy', legend: 'Layout', options: VOTING_LAYOUTS }]}
        />
      )}
      <Alert tone="info" className="mb-4" title="Confidential data">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="size-4" aria-hidden /> Voter identities and per-person ratings are shown only to administrators. Handle exports carefully.
        </span>
      </Alert>
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'summary', label: 'Project results', icon: BarChart3 },
          { value: 'participation', label: 'Participation', icon: Users },
        ]}
      />
      <Card>{tab === 'summary' ? <VotingSummary /> : <Participation />}</Card>
    </div>
  )
}
