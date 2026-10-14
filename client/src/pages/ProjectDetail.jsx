import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  GraduationCap,
  Lock,
  MessageSquareText,
  Pencil,
  Send,
  ThumbsDown,
  ThumbsUp,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DeadlineList, TimezoneNote } from '../components/DeadlineStatus.jsx'
import { StarRating, Stars } from '../components/StarRating.jsx'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Modal,
  PageLoader,
  StatusBadge,
  Textarea,
} from '../components/ui.jsx'
import { useAuth, useToast } from '../context/contexts.js'
import { useAsync } from '../hooks/useAsync.js'
import { api, downloadFile, getErrorMessage, getFieldErrors } from '../lib/api.js'
import { previewKind, previewPath } from '../lib/filePreview.js'
import { formatBytes, formatDateTime, formatRating } from '../lib/format.js'

const FEEDBACK_MIN = 20
const FEEDBACK_MAX = 2000

function RatingForm({ projectId, myRating, onSaved }) {
  const toast = useToast()
  const [score, setScore] = useState(myRating?.score ?? 0)
  const [feedback, setFeedback] = useState(myRating?.feedback ?? '')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const length = feedback.trim().length

  const handleSubmit = async (event) => {
    event.preventDefault()
    const nextErrors = {}
    if (!score) nextErrors.score = 'Choose a rating from 1 to 5 stars'
    if (length < FEEDBACK_MIN) nextErrors.feedback = `Please write at least ${FEEDBACK_MIN} characters`
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSaving(true)
    try {
      const { data } = await api.put(`/projects/${projectId}/rating`, { score, feedback: feedback.trim() })
      toast.success(data.message)
      onSaved(data.rating)
    } catch (error) {
      setErrors(getFieldErrors(error))
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-800">
          Your rating <span className="text-rose-600">*</span>
        </p>
        <StarRating value={score} onChange={setScore} disabled={saving} />
        {errors.score && <p className="mt-1 text-sm text-rose-600">{errors.score}</p>}
      </div>
      <Textarea
        label="What did you understand from this project?"
        required
        rows={5}
        maxLength={FEEDBACK_MAX}
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        error={errors.feedback}
        hint={`${length}/${FEEDBACK_MAX} characters · minimum ${FEEDBACK_MIN}`}
        placeholder="Summarise the problem, the approach and what stood out to you…"
        disabled={saving}
      />
      <Button type="submit" className="w-full" loading={saving} icon={Send}>
        {myRating ? 'Update my rating' : 'Submit rating'}
      </Button>
    </form>
  )
}

function RatingPanel({ data, onRatingSaved }) {
  const { project, myRating, canRate } = data

  return (
    <Card>
      <CardHeader title="Your evaluation" description="One rating per project. You can update it while voting is open." />
      <div className="p-5">
        {myRating && (
          <Alert tone="success" className="mb-4" title={`You rated this project ${myRating.score}/5`}>
            Last updated {formatDateTime(myRating.updatedAt)}
          </Alert>
        )}
        {canRate.allowed ? (
          <RatingForm key={myRating?.updatedAt ?? 'new'} projectId={project._id} myRating={myRating} onSaved={onRatingSaved} />
        ) : (
          <div className="flex gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <Lock className="mt-0.5 size-5 shrink-0 text-slate-400" aria-hidden />
            <p>{canRate.reason}</p>
          </div>
        )}
        {!canRate.allowed && myRating && (
          <blockquote className="mt-4 border-l-2 border-amber-300 pl-3 text-sm italic text-slate-600">“{myRating.feedback}”</blockquote>
        )}
      </div>
    </Card>
  )
}

function StatsPanel({ stats }) {
  if (!stats) return null
  return (
    <Card>
      <CardHeader title="Rating summary" description="Student, faculty and overall averages out of 5" />
      <div className="grid grid-cols-2 divide-x divide-slate-100">
        {[
          ['student', 'Students'],
          ['faculty', 'Faculty'],
        ].map(([group, label]) => (
          <div key={group} className="p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{formatRating(stats[group].averageRating)}</p>
            <div className="mt-1 flex justify-center">
              <Stars value={stats[group].averageRating} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {stats[group].voteCount} rating{stats[group].voteCount !== 1 && 's'}
            </p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Overall</p>
          <p className="text-xs text-slate-500">
            {stats.overall.voteCount} rating{stats.overall.voteCount !== 1 && 's'} in total
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums text-slate-900">{formatRating(stats.overall.averageRating)}</p>
          <Stars value={stats.overall.averageRating} className="size-3.5" />
        </div>
      </div>
    </Card>
  )
}

function FeedbackList({ projectId }) {
  const { data, error, loading, reload } = useAsync(
    () => api.get(`/projects/${projectId}/feedback`).then((r) => r.data.feedback),
    [projectId],
  )
  return (
    <Card>
      <CardHeader title="Evaluator feedback" description="Anonymous. Visible to presenters, the guide and administrators." />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading ? (
        <PageLoader label="Loading feedback…" />
      ) : data.length === 0 ? (
        <EmptyState icon={MessageSquareText} title="No feedback yet" description="Feedback appears here as evaluators rate the project." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((item, index) => (
            <li key={index} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={item.score} className="size-3.5" />
                <Badge tone={item.voterRole === 'faculty' ? 'brand' : 'neutral'}>{item.voterRole}</Badge>
                <span className="text-xs text-slate-400">{formatDateTime(item.updatedAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{item.feedback}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ReviewActions({ project, onReviewed }) {
  const toast = useToast()
  const [mode, setMode] = useState(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (status, reviewNote) => {
    setSaving(true)
    try {
      await api.patch(`/admin/projects/${project._id}/status`, { status, reviewNote })
      toast.success(status === 'approved' ? 'Project approved and opened for voting.' : 'Project returned to presenters.')
      setMode(null)
      onReviewed()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-slate-900">Administrator review</p>
      <p className="mt-1 text-sm text-slate-500">Approved projects appear in the gallery and can be rated.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {project.status !== 'approved' && (
          <Button variant="success" icon={ThumbsUp} loading={saving && !mode} onClick={() => submit('approved')}>
            Approve
          </Button>
        )}
        {project.status !== 'rejected' && (
          <Button variant="secondary" icon={ThumbsDown} onClick={() => setMode('reject')}>
            Request changes
          </Button>
        )}
      </div>
      <Modal
        open={mode === 'reject'}
        onClose={() => setMode(null)}
        title="Request changes"
        description="The presenters will see this note and can resubmit."
        footer={
          <>
            <Button variant="secondary" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={saving} onClick={() => submit('rejected', note)}>
              Send back
            </Button>
          </>
        }
      >
        <Textarea label="Note to presenters" rows={4} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </Card>
  )
}

export default function ProjectDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { data, error, loading, reload, setData } = useAsync(() => api.get(`/projects/${id}`).then((r) => r.data), [id])
  const [downloading, setDownloading] = useState(null)

  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={reload} title="Project unavailable" />
      </Card>
    )
  }
  if (loading && !data) return <PageLoader label="Loading project…" />

  const { project, permissions, stats } = data

  const handleDownload = async (file) => {
    setDownloading(file._id)
    try {
      await downloadFile(`/projects/${project._id}/files/${file._id}`, file.filename)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand" className="font-mono">
              {project.projectNumber}
            </Badge>
            <StatusBadge status={project.status} />
            {permissions.isOwn && <Badge>Your project</Badge>}
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">{project.title}</h1>
        </div>
        {(permissions.canEdit || permissions.canUploadFiles || permissions.canRemoveFiles) && (
          <Button as={Link} to={`/projects/${project._id}/edit`} variant="secondary" icon={Pencil}>
            {permissions.canEdit ? 'Edit project' : 'Manage files'}
          </Button>
        )}
      </div>

      {project.status === 'rejected' && project.reviewNote && (
        <Alert tone="warning" title="Changes requested by the administrator" className="mb-6">
          {project.reviewNote}
        </Alert>
      )}
      {project.status === 'pending' && permissions.isOwn && (
        <Alert tone="info" className="mb-6" title="Awaiting review">
          Your project is visible only to you and the administrators until it is approved.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5 sm:p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Project description</h2>
            <p className="mt-2 whitespace-pre-line leading-relaxed text-slate-800">{project.description || project.abstract}</p>
          </Card>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader title="Team" />
              <ul className="divide-y divide-slate-100">
                {project.teamMembers.map((member, index) => (
                  <li key={index} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      <Users className="size-4" aria-hidden />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{member.name}</p>
                      {member.rollNumber && <p className="font-mono text-xs text-slate-500">{member.rollNumber}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Faculty guide" />
              <div className="flex items-center gap-3 px-5 py-4">
                <span className="flex size-10 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                  <GraduationCap className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-medium text-slate-900">{project.facultyGuide || 'Not available'}</p>
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Supporting files" description="Reports, slides and screenshots shared by the team" />
            {project.files.length === 0 ? (
              <EmptyState icon={FileText} title="No files attached" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {project.files.map((file) => (
                  <li key={file._id} className="flex items-center gap-3 px-5 py-3">
                    <FileText className="size-5 shrink-0 text-slate-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{file.filename}</p>
                      <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                    </div>
                    {previewKind(file.filename) ? (
                      <Button
                        as="a"
                        href={previewPath(project._id, file._id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="ghost"
                        size="sm"
                        icon={Eye}
                        aria-label={`View ${file.filename} in a new tab`}
                      >
                        View
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400" title="This file type can't be previewed in the browser. Download it to open it.">
                        No preview
                      </span>
                    )}
                    <Button variant="ghost" size="sm" icon={Download} loading={downloading === file._id} onClick={() => handleDownload(file)}>
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {permissions.canViewFeedback && <FeedbackList projectId={project._id} />}
        </div>

        <aside className="space-y-6">
          {user.role === 'admin' ? (
            <ReviewActions project={project} onReviewed={reload} />
          ) : (
            !permissions.isOwn && (
              <RatingPanel
                data={data}
                onRatingSaved={(rating) => {
                  setData((prev) => ({ ...prev, myRating: rating }))
                  reload() // refresh the group averages
                }}
              />
            )
          )}
          {permissions.isOwn && project.status !== 'approved' && data.deadlines && (
            <Card>
              <CardHeader title="Presenter deadlines" description="Set by the administrator" />
              <DeadlineList deadlines={data.deadlines} />
              <div className="space-y-1 px-5 pb-4">
                {!permissions.canEdit && permissions.reasons.edit && <p className="text-xs text-rose-600">{permissions.reasons.edit}</p>}
                {!permissions.canManageFiles && permissions.reasons.files && permissions.reasons.files !== permissions.reasons.edit && (
                  <p className="text-xs text-rose-600">{permissions.reasons.files}</p>
                )}
                <TimezoneNote deadlines={data.deadlines} />
              </div>
            </Card>
          )}
          {permissions.isOwn && (
            <Card className="p-5">
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                <p className="text-sm text-slate-600">
                  Presenters cannot rate their own project. Anonymous feedback from evaluators appears on this page.
                </p>
              </div>
            </Card>
          )}
          <StatsPanel stats={stats} />
          <Card className="p-5 text-sm text-slate-500">
            <p>
              Submitted by <span className="font-medium text-slate-700">{project.submittedBy?.name ?? '—'}</span>
            </p>
            <p className="mt-1">Last updated {formatDateTime(project.updatedAt)}</p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
