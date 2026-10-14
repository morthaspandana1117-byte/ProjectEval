import { FileText, Plus, Save, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Input,
  PageHeader,
  PageLoader,
  Textarea,
} from '../components/ui.jsx'
import { useAuth, useToast } from '../context/contexts.js'
import { useAsync } from '../hooks/useAsync.js'
import { api, getErrorMessage, getFieldErrors } from '../lib/api.js'
import { formatBytes } from '../lib/format.js'
import { DeadlineList, TimezoneNote } from '../components/DeadlineStatus.jsx'
import { projectFormMode } from '../lib/projectFormMode.js'

const MAX_FILES = 5
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.docx', '.pptx']
const GUIDE_NAME_MAX = 100 // matches the server's GUIDE_NAME_MAX
const DESCRIPTION_MIN = 20 // matches the server's DESCRIPTION_MIN
const DESCRIPTION_MAX = 8000 // matches the server's DESCRIPTION_MAX

function FilesSection({ project, pendingFiles, setPendingFiles, onExistingRemoved, canUpload, canRemove, closedReason }) {
  const toast = useToast()
  const inputRef = useRef(null)
  const [removing, setRemoving] = useState(null)
  const existing = project?.files ?? []
  const remaining = MAX_FILES - existing.length - pendingFiles.length

  const pick = (event) => {
    const chosen = Array.from(event.target.files ?? [])
    event.target.value = ''
    const accepted = []
    for (const file of chosen) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      if (!ALLOWED.includes(ext)) toast.error(`${file.name}: unsupported type. Allowed: ${ALLOWED.join(', ')}`)
      else if (file.size > MAX_SIZE) toast.error(`${file.name} is larger than 5 MB.`)
      else accepted.push(file)
    }
    if (accepted.length > remaining) toast.error(`You can attach ${Math.max(remaining, 0)} more file(s).`)
    setPendingFiles((list) => [...list, ...accepted.slice(0, Math.max(remaining, 0))])
  }

  const removeExisting = async (file) => {
    setRemoving(file._id)
    try {
      const { data } = await api.delete(`/projects/${project._id}/files/${file._id}`)
      onExistingRemoved(data.files)
      toast.success('File removed.')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setRemoving(null)
    }
  }

  const rows = [
    ...existing.map((f) => ({ ...f, saved: true })),
    ...pendingFiles.map((f, i) => ({ _id: `new-${i}`, filename: f.name, size: f.size, index: i })),
  ]

  return (
    <Card>
      <CardHeader title="Supporting files" description={`PDF, images, DOCX or PPTX · up to ${MAX_FILES} files · 5 MB each`} />
      <div className="space-y-3 p-5">
        {!canUpload && (
          <Alert tone="warning" title="File uploads are closed">
            {closedReason ?? 'Files cannot be changed right now.'}
          </Alert>
        )}
        {rows.length === 0 && canUpload && <p className="text-sm text-slate-500">No files attached yet.</p>}
        {rows.map((file) => (
          <div key={file._id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
            <FileText className="size-5 shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{file.filename}</p>
              <p className="text-xs text-slate-500">
                {formatBytes(file.size)} · {file.saved ? 'Uploaded' : 'Will upload on save'}
              </p>
            </div>
            {(!file.saved || canRemove) && (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                loading={removing === file._id}
                aria-label={`Remove ${file.filename}`}
                onClick={() => (file.saved ? removeExisting(file) : setPendingFiles((list) => list.filter((_, i) => i !== file.index)))}
              />
            )}
          </div>
        ))}
        {canUpload && (
          <>
            <input ref={inputRef} type="file" multiple accept={ALLOWED.join(',')} className="hidden" onChange={pick} />
            <Button variant="secondary" icon={Upload} disabled={remaining <= 0} onClick={() => inputRef.current?.click()}>
              {remaining <= 0 ? 'File limit reached' : 'Add files'}
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}

function toForm(project, user) {
  if (!project) {
    return {
      projectNumber: '',
      title: '',
      description: '',
      teamMembers: [{ name: user.name, rollNumber: user.rollNumber ?? '' }],
      facultyGuide: '',
    }
  }
  return {
    projectNumber: project.projectNumber,
    title: project.title,
    description: project.description ?? '',
    teamMembers: project.teamMembers.map((m) => ({ name: m.name, rollNumber: m.rollNumber ?? '' })),
    facultyGuide: typeof project.facultyGuide === 'string' ? project.facultyGuide : '',
  }
}

/**
 * Details and files are handled independently, using the server's permissions:
 * canEdit (details), canUploadFiles and canRemoveFiles. New projects use the upload deadline status.
 */
function ProjectEditor({ project: initialProject, permissions, deadlines }) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [project, setProject] = useState(initialProject)
  const [form, setForm] = useState(() => toForm(initialProject, user))
  const [pendingFiles, setPendingFiles] = useState([])
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false) // blocks a second submit before the disabled button re-renders

  // Fixed by how the form was opened. Deriving it from `project` state crashed the page right after a
  // new project was created (state set, but no `permissions` for a new project).
  const { isEdit, canEditDetails, canUpload, canRemove, filesReason, filesOnly } = projectFormMode({
    isNew: !initialProject,
    permissions,
    deadlines,
  })

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))
  const setMember = (index, field, value) =>
    setForm((f) => ({ ...f, teamMembers: f.teamMembers.map((m, i) => (i === index ? { ...m, [field]: value } : m)) }))

  const finishWithError = (message) => {
    setFormError(message)
    setSaving(false)
    submittingRef.current = false
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submittingRef.current) return
    if (canEditDetails && form.description.trim().length < DESCRIPTION_MIN) {
      setErrors({ description: `Please describe your project in at least ${DESCRIPTION_MIN} characters` })
      setFormError('Please correct the highlighted fields.')
      return
    }
    submittingRef.current = true
    setSaving(true)
    setErrors({})
    setFormError('')
    let saved = project
    if (canEditDetails) {
      try {
        const { data } = isEdit ? await api.patch(`/projects/${project._id}`, form) : await api.post('/projects', form)
        saved = data.project
        if (isEdit) setProject(saved)
      } catch (error) {
        setErrors(getFieldErrors(error))
        finishWithError(getErrorMessage(error))
        return
      }
    }

    if (pendingFiles.length && canUpload) {
      const body = new FormData()
      pendingFiles.forEach((file) => body.append('files', file))
      try {
        await api.post(`/projects/${saved._id}/files`, body)
        setPendingFiles([])
      } catch (error) {
        if (!isEdit) {
          // The project already exists; staying on this form would let the next submit create a duplicate.
          toast.error(`Project submitted for review, but files could not be uploaded: ${getErrorMessage(error)}`)
          navigate(`/projects/${saved._id}`, { replace: true })
          return
        }
        finishWithError(
          canEditDetails
            ? `Project saved, but files could not be uploaded: ${getErrorMessage(error)}`
            : `Files could not be uploaded: ${getErrorMessage(error)}`,
        )
        return
      }
    }

    toast.success(filesOnly ? 'Files uploaded.' : isEdit ? 'Project updated.' : 'Project submitted for review.')
    // Replace the "new project" entry so Back cannot return to the filled form and resubmit it.
    navigate(`/projects/${saved._id}`, { replace: !isEdit })
  }

  const memberError = (index, field) => errors[`teamMembers.${index}.${field}`]
  const submitLabel = filesOnly ? 'Upload files' : isEdit ? 'Save changes' : 'Submit for review'

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {formError && <Alert tone="danger">{formError}</Alert>}
      {canEditDetails && project?.status === 'rejected' && project.reviewNote && (
        <Alert tone="warning" title="Changes requested">
          {project.reviewNote} — saving will resubmit the project for review.
        </Alert>
      )}
      {filesOnly && (
        <Alert tone="warning" title="Project details are read-only">
          {permissions.reasons.edit} You can still manage supporting files below.
        </Alert>
      )}
      {!isEdit && !canUpload && (
        <Alert tone="warning" title="Files cannot be attached right now">
          {filesReason} You can submit the project details, but supporting files cannot be uploaded until the administrator
          reopens uploads.
        </Alert>
      )}

      <fieldset disabled={!canEditDetails} className="min-w-0 space-y-6">
        <Card>
          <CardHeader title="Project details" />
          <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Input
              label="Project number"
              required
              value={form.projectNumber}
              onChange={set('projectNumber')}
              error={errors.projectNumber}
              placeholder="CSE-042"
              hint="Unique, e.g. stall number"
            />
            <Input label="Title" required value={form.title} onChange={set('title')} error={errors.title} maxLength={200} />
            <Textarea
              label="Project description"
              required
              className="sm:col-span-2"
              rows={4}
              maxLength={DESCRIPTION_MAX}
              value={form.description}
              onChange={set('description')}
              error={errors.description}
              placeholder="Briefly describe your project, its purpose, and what it does..."
              hint={`At least ${DESCRIPTION_MIN} characters · ${form.description.trim().length} written`}
            />
            <Input
              label="Faculty guide"
              required
              className="sm:col-span-2"
              value={form.facultyGuide}
              onChange={set('facultyGuide')}
              error={errors.facultyGuide}
              maxLength={GUIDE_NAME_MAX}
              placeholder="e.g. Dr. Meera Iyer"
              hint="Type your guide's full name. They do not need a ProjectEval account."
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Team members"
            description="Members listed with a roll number cannot rate this project."
            action={
              canEditDetails &&
              form.teamMembers.length < 10 && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Plus}
                  onClick={() => setForm((f) => ({ ...f, teamMembers: [...f.teamMembers, { name: '', rollNumber: '' }] }))}
                >
                  Add member
                </Button>
              )
            }
          />
          <div className="space-y-3 p-5">
            {errors.teamMembers && <p className="text-sm text-rose-600">{errors.teamMembers}</p>}
            {form.teamMembers.map((member, index) => (
              <div key={index} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
                <Input
                  aria-label={`Member ${index + 1} name`}
                  placeholder="Full name"
                  value={member.name}
                  onChange={(e) => setMember(index, 'name', e.target.value)}
                  error={memberError(index, 'name')}
                />
                <Input
                  aria-label={`Member ${index + 1} roll number`}
                  placeholder="Roll number"
                  value={member.rollNumber}
                  onChange={(e) => setMember(index, 'rollNumber', e.target.value)}
                  error={memberError(index, 'rollNumber')}
                />
                <Button
                  variant="ghost"
                  icon={Trash2}
                  aria-label={`Remove member ${index + 1}`}
                  disabled={form.teamMembers.length === 1}
                  onClick={() => setForm((f) => ({ ...f, teamMembers: f.teamMembers.filter((_, i) => i !== index) }))}
                />
              </div>
            ))}
          </div>
        </Card>
      </fieldset>

      <FilesSection
        project={project}
        pendingFiles={pendingFiles}
        setPendingFiles={setPendingFiles}
        onExistingRemoved={(files) => setProject((p) => ({ ...p, files }))}
        canUpload={canUpload}
        canRemove={canRemove}
        closedReason={filesReason}
      />

      <div className="flex flex-wrap justify-end gap-3">
        <Button as={Link} to={isEdit ? `/projects/${project._id}` : '/my-projects'} variant="secondary">
          {filesOnly ? 'Done' : 'Cancel'}
        </Button>
        <Button type="submit" loading={saving} icon={filesOnly ? Upload : Save} disabled={filesOnly && pendingFiles.length === 0}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export default function ProjectForm() {
  const { id } = useParams()
  const { user } = useAuth()
  // Fresh server status for deadlines and (when editing) per-project permissions.
  const { data, error, loading, reload } = useAsync(async () => {
    const [me, project] = await Promise.all([
      api.get('/auth/me').then((r) => r.data),
      id ? api.get(`/projects/${id}`).then((r) => r.data) : null,
    ])
    return { deadlines: me.deadlines, project }
  }, [id])

  const header = (
    <PageHeader
      eyebrow={id ? 'Edit submission' : 'New submission'}
      title={id ? 'Edit project' : 'Submit a project'}
      description="Projects are reviewed by the administrator before they appear in the gallery."
    />
  )

  if (error) {
    return (
      <>
        {header}
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      </>
    )
  }
  if (loading) return <PageLoader />

  const { deadlines } = data
  const deadlineCard = user.role !== 'admin' && deadlines && (
    <Card>
      <CardHeader title="Deadlines" description="Set by the administrator" />
      <DeadlineList deadlines={deadlines} />
      <div className="px-5 pb-4">
        <TimezoneNote deadlines={deadlines} />
      </div>
    </Card>
  )

  if (id) {
    const { permissions } = data.project
    const anyFileAction = permissions.canUploadFiles || permissions.canRemoveFiles
    if (!permissions.canEdit && !anyFileAction) {
      const sameReason = permissions.reasons.edit === permissions.reasons.files
      return (
        <div className="mx-auto max-w-4xl space-y-4">
          {header}
          <Alert tone="warning" title={sameReason ? 'This project can no longer be changed' : 'Editing is closed'}>
            {permissions.reasons.edit}
          </Alert>
          {!sameReason && (
            <Alert tone="warning" title="File uploads are closed">
              {permissions.reasons.files}
            </Alert>
          )}
          {deadlineCard}
          <Button as={Link} to={`/projects/${id}`} variant="secondary">
            Back to project
          </Button>
        </div>
      )
    }
  } else if (!deadlines?.submission.open) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {header}
        <Alert tone="warning" title="New submissions are closed">
          {deadlines?.submission.reason ?? 'The administrator is not accepting new projects right now.'}
        </Alert>
        {deadlineCard}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {header}
      {deadlineCard}
      <ProjectEditor
        key={id ?? 'new'}
        project={data.project?.project ?? null}
        permissions={data.project?.permissions ?? null}
        deadlines={deadlines}
      />
    </div>
  )
}
