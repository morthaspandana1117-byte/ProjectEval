import { Eye, FolderKanban, Search, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Pagination,
  Skeleton,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
} from '../../components/ui.jsx'
import { useToast } from '../../context/contexts.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js'
import { api, getErrorMessage } from '../../lib/api.js'
import { formatDate } from '../../lib/format.js'

export default function AdminProjects() {
  const toast = useToast()
  const [status, setStatus] = useState('pending')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebouncedValue(search.trim())
  const [rejecting, setRejecting] = useState(null)
  const [note, setNote] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(null)

  const { data, error, loading, reload } = useAsync(
    () => api.get('/projects', { params: { status: status || undefined, search: debounced || undefined, page, limit: 20 } }).then((r) => r.data),
    [status, debounced, page],
  )

  const review = async (project, nextStatus, reviewNote) => {
    setBusy(project._id)
    try {
      await api.patch(`/admin/projects/${project._id}/status`, { status: nextStatus, reviewNote })
      toast.success(nextStatus === 'approved' ? `${project.projectNumber} approved.` : `${project.projectNumber} sent back for changes.`)
      setRejecting(null)
      setNote('')
      reload()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy(deleting._id)
    try {
      await api.delete(`/projects/${deleting._id}`)
      toast.success('Project deleted along with its files and ratings.')
      setDeleting(null)
      reload()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Project review" description="Approve submissions to open them for rating, or request changes." />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={status}
          onChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
          tabs={[
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Changes requested' },
            { value: '', label: 'All' },
          ]}
        />
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search projects</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search projects"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </label>
      </div>

      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : data.projects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="No projects here" description={status === 'pending' ? 'Nothing is waiting for review.' : 'Try another filter.'} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>Submitted by</Th>
                  <Th>Guide</Th>
                  <Th>Status</Th>
                  <Th>Votes (S / F)</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.projects.map((project) => (
                  <tr key={project._id} className="hover:bg-slate-50/60">
                    <Td className="max-w-xs">
                      <p className="font-mono text-xs font-semibold text-brand-700">{project.projectNumber}</p>
                      <p className="truncate font-medium text-slate-900">{project.title}</p>
                      <p className="text-xs text-slate-400">{formatDate(project.createdAt)}</p>
                    </Td>
                    <Td>
                      <p>{project.submittedBy?.name ?? '—'}</p>
                      <p className="font-mono text-xs text-slate-400">{project.submittedBy?.rollNumber}</p>
                    </Td>
                    <Td>{project.facultyGuide || '—'}</Td>
                    <Td>
                      <StatusBadge status={project.status} />
                    </Td>
                    <Td className="tabular-nums">
                      {project.stats ? `${project.stats.student.voteCount} / ${project.stats.faculty.voteCount}` : '—'}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button as={Link} to={`/projects/${project._id}`} variant="ghost" size="sm" icon={Eye} aria-label={`View ${project.title}`} />
                        {project.status !== 'approved' && (
                          <Button variant="ghost" size="sm" icon={ThumbsUp} className="text-emerald-700 hover:bg-emerald-50" loading={busy === project._id} onClick={() => review(project, 'approved')}>
                            Approve
                          </Button>
                        )}
                        {project.status !== 'rejected' && (
                          <Button variant="ghost" size="sm" icon={ThumbsDown} onClick={() => setRejecting(project)}>
                            Changes
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" icon={Trash2} className="text-rose-600 hover:bg-rose-50" aria-label={`Delete ${project.title}`} onClick={() => setDeleting(project)} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="px-4">
              <Pagination pagination={data.pagination} onPage={setPage} />
            </div>
          </>
        )}
      </Card>

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={`Request changes — ${rejecting?.projectNumber ?? ''}`}
        description="The presenters will see this note on their submission."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy === rejecting?._id} onClick={() => review(rejecting, 'rejected', note)}>
              Send back
            </Button>
          </>
        }
      >
        <Textarea label="Note to presenters" rows={4} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain what needs to change…" />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete project permanently?"
        message={`This removes “${deleting?.title}”, its uploaded files and all of its ratings. This cannot be undone.`}
        confirmLabel="Delete project"
        loading={busy === deleting?._id}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
