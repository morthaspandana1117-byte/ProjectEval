import { CheckCheck, Download, Search, UserCheck, UserX, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx'
import { ExportDialog } from '../../components/ExportDialog.jsx'
import { useToast } from '../../context/contexts.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js'
import { api, getErrorMessage } from '../../lib/api.js'
import { LAYOUT_OPTIONS } from '../../lib/exportOptions.js'
import { formatSession } from '../../lib/format.js'

export default function Attendance() {
  const toast = useToast()
  const [session, setSession] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [saving, setSaving] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)
  const debounced = useDebouncedValue(search.trim())

  const { data, error, loading, reload, setData } = useAsync(
    () =>
      api
        .get('/admin/attendance', { params: { session: session || undefined, search: debounced || undefined, status: status || undefined } })
        .then((r) => r.data),
    [session, debounced, status],
  )

  const currentSession = session || data?.session
  const students = data?.students ?? []
  const allSelected = students.length > 0 && students.every((s) => selected.has(s._id))

  const mark = async (ids, nextStatus, key) => {
    if (!ids.length) return
    setSaving(key)
    try {
      const { data: result } = await api.put('/admin/attendance', {
        session: currentSession,
        records: ids.map((studentId) => ({ studentId, status: nextStatus })),
      })
      // Update rows in place so the table does not jump while marking quickly.
      setData((prev) => {
        const idSet = new Set(ids)
        const summary = { ...prev.summary }
        const rows = prev.students.map((row) => {
          if (!idSet.has(row._id) || row.status === nextStatus) return row
          summary[row.status] -= 1
          summary[nextStatus] += 1
          return { ...row, status: nextStatus, markedAt: new Date().toISOString() }
        })
        return { ...prev, summary, students: rows }
      })
      setSelected(new Set())
      if (ids.length > 1) toast.success(result.message)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSaving(null)
    }
  }

  const describeExport = ({ scope, groupBy }) => {
    const session = scope === 'all' ? 'all' : currentSession
    return {
      url: `/admin/attendance/export?session=${session}&groupBy=${groupBy}`,
      filename: `attendance-${session}${groupBy === 'year' ? '-by-year' : ''}.xlsx`,
    }
  }

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Attendance"
        description="Students can vote only when marked present for the active session."
        actions={
          <Button variant="secondary" icon={Download} disabled={!currentSession} onClick={() => setExportOpen(true)}>
            Export to Excel
          </Button>
        }
      />

      {exportOpen && (
        <ExportDialog
          open
          onClose={() => setExportOpen(false)}
          title="Export attendance"
          description="Exports use the saved attendance records. Search and status filters on this page are not applied."
          initialValues={{ scope: 'session', groupBy: 'none' }}
          describe={describeExport}
          fields={[
            {
              name: 'scope',
              legend: 'Which attendance?',
              options: [
                { value: 'session', label: `Session ${currentSession}`, hint: 'Every active student with their status for this session.' },
                { value: 'all', label: 'All sessions', hint: 'One row per attendance record across every session.' },
              ],
            },
            { name: 'groupBy', legend: 'Layout', options: LAYOUT_OPTIONS },
          ]}
        />
      )}

      {data && currentSession !== data.activeSession && (
        <Alert tone="warning" className="mb-4">
          You are viewing {formatSession(currentSession)}. Voting eligibility uses the active session ({formatSession(data.activeSession)}).{' '}
          <Link to="/admin/settings" className="font-semibold underline">
            Change active session
          </Link>
        </Alert>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[12rem_1fr_12rem]">
          <Input
            type="date"
            label="Session date"
            value={currentSession ?? ''}
            onChange={(e) => {
              setSession(e.target.value)
              setSelected(new Set())
            }}
          />
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-slate-800">Search</span>
            <label className="relative block">
              <span className="sr-only">Search students</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, roll number, email or department"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All students</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="unmarked">Not marked</option>
          </Select>
        </div>
      </Card>

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Students', data.summary.total, 'text-slate-900'],
            ['Present', data.summary.present, 'text-emerald-700'],
            ['Absent', data.summary.absent, 'text-rose-700'],
            ['Not marked', data.summary.unmarked, 'text-slate-500'],
          ].map(([label, value, color]) => (
            <Card key={label} className="px-4 py-3">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-brand-50 px-4 py-3 text-sm">
            <span className="font-medium text-brand-900">{selected.size} selected</span>
            <Button size="sm" variant="success" icon={UserCheck} loading={saving === 'bulk-present'} onClick={() => mark([...selected], 'present', 'bulk-present')}>
              Mark present
            </Button>
            <Button size="sm" variant="secondary" icon={UserX} loading={saving === 'bulk-absent'} onClick={() => mark([...selected], 'absent', 'bulk-absent')}>
              Mark absent
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <EmptyState
            icon={Users}
            title={debounced || status ? 'No matching students' : 'No students registered yet'}
            description={debounced || status ? 'Adjust the search or status filter.' : 'Students appear here once an administrator adds them.'}
          />
        ) : (
          <>
            <div className="flex justify-end border-b border-slate-100 px-4 py-2">
              <Button
                size="sm"
                variant="ghost"
                icon={CheckCheck}
                loading={saving === 'all-present'}
                onClick={() => mark(students.filter((s) => s.status !== 'present').map((s) => s._id), 'present', 'all-present')}
              >
                Mark all listed present
              </Button>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all students"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(students.map((s) => s._id)))}
                      className="size-4 rounded border-slate-300 accent-brand-700"
                    />
                  </Th>
                  <Th>Student</Th>
                  <Th>Roll no.</Th>
                  <Th>Department</Th>
                  <Th>Rated</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Mark</Th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-slate-100 bg-white ${loading ? 'opacity-60' : ''}`}>
                {students.map((student) => (
                  <tr key={student._id} className={selected.has(student._id) ? 'bg-brand-50/50' : 'hover:bg-slate-50/60'}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${student.name}`}
                        checked={selected.has(student._id)}
                        onChange={() => toggle(student._id)}
                        className="size-4 rounded border-slate-300 accent-brand-700"
                      />
                    </Td>
                    <Td>
                      <p className="font-medium text-slate-900">{student.name}</p>
                      <p className="text-xs text-slate-400">{student.email}</p>
                    </Td>
                    <Td className="font-mono text-xs">{student.rollNumber ?? '—'}</Td>
                    <Td>
                      {student.department ?? '—'}
                      {student.year && <span className="text-slate-400"> · Y{student.year}</span>}
                    </Td>
                    <Td className="tabular-nums">{student.votesCast}</Td>
                    <Td>
                      <StatusBadge status={student.status} />
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant={student.status === 'present' ? 'success' : 'secondary'}
                          loading={saving === `${student._id}-present`}
                          onClick={() => mark([student._id], 'present', `${student._id}-present`)}
                          aria-pressed={student.status === 'present'}
                        >
                          Present
                        </Button>
                        <Button
                          size="sm"
                          variant={student.status === 'absent' ? 'danger' : 'secondary'}
                          loading={saving === `${student._id}-absent`}
                          onClick={() => mark([student._id], 'absent', `${student._id}-absent`)}
                          aria-pressed={student.status === 'absent'}
                        >
                          Absent
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Card>
    </div>
  )
}
