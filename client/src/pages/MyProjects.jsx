import { Eye, FileStack, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DeadlineList, TimezoneNote } from '../components/DeadlineStatus.jsx'
import { Alert, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../components/ui.jsx'
import { useToast } from '../context/contexts.js'
import { useAsync } from '../hooks/useAsync.js'
import { api, getErrorMessage } from '../lib/api.js'
import { formatDate } from '../lib/format.js'

export default function MyProjects() {
  const toast = useToast()
  // The server returns per-project permissions and the current deadline status.
  const { data, error, loading, reload, setData } = useAsync(() => api.get('/projects/mine').then((r) => r.data), [])
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const projects = data?.projects ?? []
  const deadlines = data?.deadlines
  const submissionOpen = Boolean(deadlines?.submission.open)

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await api.delete(`/projects/${toDelete._id}`)
      setData((prev) => ({ ...prev, projects: prev.projects.filter((p) => p._id !== toDelete._id) }))
      toast.success('Project deleted.')
      setToDelete(null)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  const submitButton = (label) =>
    submissionOpen && (
      <Button as={Link} to="/my-projects/new" icon={Plus}>
        {label}
      </Button>
    )

  return (
    <div>
      <PageHeader
        eyebrow="Presenter"
        title="My submissions"
        description="Track the review status of the projects you are presenting."
        actions={submitButton('Submit project')}
      />
      {deadlines && !submissionOpen && (
        <Alert tone="info" className="mb-6" title="New submissions are closed">
          {deadlines.submission.reason} Editing and file uploads follow their own deadlines.
        </Alert>
      )}

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-4">
            {projects.length === 0 ? (
              <Card>
                <EmptyState
                  icon={FileStack}
                  title="You have not submitted any projects"
                  description="Submit your project with a short description, team, guide and supporting files."
                  action={submitButton('Submit your first project')}
                />
              </Card>
            ) : (
              projects.map((project) => {
                const p = project.permissions
                const canChangeFiles = p.canUploadFiles || p.canRemoveFiles
                const closedNotes = [
                  !p.canEdit && p.reasons.edit,
                  !p.canManageFiles && p.reasons.files !== p.reasons.edit && p.reasons.files,
                ].filter(Boolean)
                return (
                  <Card key={project._id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-brand-700">{project.projectNumber}</span>
                          <StatusBadge status={project.status} />
                        </div>
                        <h2 className="mt-1 text-lg font-semibold">{project.title}</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Guide: {project.facultyGuide || '—'} · Submitted {formatDate(project.createdAt)} · {project.files.length} file(s)
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button as={Link} to={`/projects/${project._id}`} variant="secondary" size="sm" icon={Eye}>
                          View
                        </Button>
                        {(p.canEdit || canChangeFiles) && (
                          <Button
                            as={Link}
                            to={`/projects/${project._id}/edit`}
                            variant="secondary"
                            size="sm"
                            icon={p.canEdit ? Pencil : Upload}
                          >
                            {p.canEdit ? 'Edit' : 'Manage files'}
                          </Button>
                        )}
                        {p.canDelete && (
                          <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToDelete(project)} className="text-rose-600 hover:bg-rose-50">
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                    {project.status === 'rejected' && project.reviewNote && (
                      <Alert tone="warning" className="mt-4" title="Changes requested">
                        {project.reviewNote}
                      </Alert>
                    )}
                    {project.status !== 'approved' && closedNotes.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {closedNotes.map((note) => (
                          <p key={note} className="text-xs text-rose-600">
                            {note}
                          </p>
                        ))}
                      </div>
                    )}
                  </Card>
                )
              })
            )}
          </div>

          {deadlines && (
            <Card className="h-fit">
              <CardHeader title="Deadlines" description="Set by the administrator" />
              <DeadlineList deadlines={deadlines} />
              <div className="px-5 pb-4">
                <TimezoneNote deadlines={deadlines} />
              </div>
            </Card>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete this project?"
        message={`“${toDelete?.title}” and its files will be permanently removed.`}
        confirmLabel="Delete project"
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
