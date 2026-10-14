import { Save, X } from 'lucide-react'
import { useState } from 'react'
import { Alert, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, PageLoader, Toggle } from '../../components/ui.jsx'
import { useAuth, useToast } from '../../context/contexts.js'
import { useAsync } from '../../hooks/useAsync.js'
import { api, getErrorMessage, getFieldErrors } from '../../lib/api.js'
import { todayLocal } from '../../lib/format.js'

const DEADLINES = [
  {
    field: 'submissionDeadline',
    key: 'submission',
    label: 'Project submission deadline',
    hint: 'Presenters can create new projects until this time (the submission switch must also be on).',
  },
  {
    field: 'editDeadline',
    key: 'edit',
    label: 'Project editing deadline',
    hint: 'Presenters can edit or delete their unapproved projects until this time.',
  },
  {
    field: 'uploadDeadline',
    key: 'upload',
    label: 'File upload deadline',
    hint: 'Presenters can upload, replace or remove project files until this time.',
  },
]

const tzLabel = (tz) => (tz === 'Asia/Kolkata' ? 'IST' : tz)

// Deadlines are edited as "YYYY-MM-DDTHH:mm" wall-clock values in the event timezone ('' = no deadline).
const deadlineValues = (deadlines) => Object.fromEntries(DEADLINES.map(({ field, key }) => [field, deadlines?.[key]?.local ?? '']))

function DeadlineField({ config, value, savedValue, summary, serverNow, timezone, error, onChange }) {
  const saved = summary?.[config.key]
  const changed = value !== savedValue
  const passed = value !== '' && serverNow && value <= serverNow
  const inputId = `deadline-${config.field}`

  let status
  if (value === '') status = 'No deadline — open indefinitely'
  else if (!changed && saved?.display) status = `Closes ${saved.display}`
  else status = `Closes ${value.replace('T', ' ')} ${tzLabel(timezone)} (not saved yet)`

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-4">
      <Field label={`${config.label} (${tzLabel(timezone)})`} hint={config.hint} error={error} id={inputId}>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="datetime-local"
            step={60}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(error)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <Button variant="secondary" icon={X} disabled={value === ''} onClick={() => onChange('')}>
            No deadline
          </Button>
        </div>
      </Field>
      <p className={`text-sm ${value === '' ? 'text-slate-500' : 'font-medium text-slate-700'}`}>{status}</p>
      {saved?.invalid && !changed && (
        <Alert tone="danger">The stored value is invalid, so this action is closed. Set a new deadline or clear it.</Alert>
      )}
      {passed && <Alert tone="warning">This deadline has already passed — the action is closed for presenters.</Alert>}
    </div>
  )
}

function SettingsForm({ initial, initialDeadlines }) {
  const toast = useToast()
  const { refresh } = useAuth()
  const [form, setForm] = useState(initial)
  const [summary, setSummary] = useState(initialDeadlines)
  const [deadlineForm, setDeadlineForm] = useState(() => deadlineValues(initialDeadlines))
  const [savedDeadlines, setSavedDeadlines] = useState(() => deadlineValues(initialDeadlines))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }))
  const timezone = summary?.eventTimezone ?? initial.eventTimezone

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const { eventName, votingOpen, submissionsOpen, leaderboardVisible, activeSession } = form
      // Send only the deadlines that changed, so untouched deadlines are never cleared.
      const changedDeadlines = Object.fromEntries(
        DEADLINES.filter(({ field }) => deadlineForm[field] !== savedDeadlines[field]).map(({ field }) => [
          field,
          deadlineForm[field] === '' ? null : deadlineForm[field],
        ]),
      )
      const { data } = await api.patch('/admin/settings', {
        eventName,
        votingOpen,
        submissionsOpen,
        leaderboardVisible,
        activeSession,
        ...changedDeadlines,
      })
      setForm(data.settings)
      setSummary(data.deadlines)
      setDeadlineForm(deadlineValues(data.deadlines))
      setSavedDeadlines(deadlineValues(data.deadlines))
      await refresh()
      toast.success('Settings saved.')
    } catch (error) {
      setErrors(getFieldErrors(error))
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const { submissionDeadline, editDeadline, uploadDeadline } = deadlineForm
  const unusualOrder =
    submissionDeadline !== '' &&
    ((editDeadline !== '' && editDeadline < submissionDeadline) || (uploadDeadline !== '' && uploadDeadline < submissionDeadline))

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Card>
        <CardHeader title="Event" />
        <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          <Input label="Event name" value={form.eventName ?? ''} onChange={(e) => set('eventName')(e.target.value)} error={errors.eventName} />
          <Input
            label="Active session date"
            type="date"
            value={form.activeSession ?? ''}
            onChange={(e) => set('activeSession')(e.target.value)}
            error={errors.activeSession}
            hint="Students must be marked present for this date to vote."
          />
        </div>
        {form.activeSession && form.activeSession !== todayLocal() && (
          <div className="px-5 pb-5">
            <Alert tone="warning">The active session is not today. Make sure this is intentional.</Alert>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Presenter deadlines"
          description={`Each deadline is independent. Times are in ${timezone} (${tzLabel(timezone)}). Actions close at the exact deadline. Administrators are not restricted.`}
        />
        <div className="space-y-4 p-5">
          {DEADLINES.map((config) => (
            <DeadlineField
              key={config.field}
              config={config}
              value={deadlineForm[config.field]}
              savedValue={savedDeadlines[config.field]}
              summary={summary}
              serverNow={summary?.serverTimeLocal}
              timezone={timezone}
              error={errors[config.field]}
              onChange={(value) => setDeadlineForm((d) => ({ ...d, [config.field]: value }))}
            />
          ))}
          {unusualOrder && (
            <Alert tone="info">
              The editing or upload deadline is earlier than the submission deadline, so late submitters may not be able to edit
              or attach files. This is allowed, but check that it is intended.
            </Alert>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Access controls" />
        <div className="space-y-5 p-5">
          <Toggle
            label="Voting open"
            description="When off, nobody can submit or update ratings."
            checked={form.votingOpen}
            onChange={set('votingOpen')}
          />
          <Toggle
            label="Accept new project submissions"
            description="Manual switch. New projects need this ON and the submission deadline not yet passed. Editing and uploads follow their own deadlines."
            checked={form.submissionsOpen}
            onChange={set('submissionsOpen')}
          />
          <Toggle
            label="Publish leaderboards"
            description="When off, only administrators can see rankings and rating averages."
            checked={form.leaderboardVisible}
            onChange={set('leaderboardVisible')}
          />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={saving} icon={Save}>
          Save settings
        </Button>
      </div>
    </form>
  )
}

export default function EventSettings() {
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/settings').then((r) => r.data), [])
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Administration" title="Event settings" description="Control voting, submissions, deadlines and result visibility." />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : loading ? (
        <PageLoader />
      ) : (
        <SettingsForm initial={data.settings} initialDeadlines={data.deadlines} />
      )}
    </div>
  )
}
