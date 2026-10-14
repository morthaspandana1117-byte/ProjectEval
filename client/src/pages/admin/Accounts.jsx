import { KeyRound, Pencil, Search, Trash2, UserCog, UserPlus } from 'lucide-react'
import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
  Toggle,
} from '../../components/ui.jsx'
import { useToast } from '../../context/contexts.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js'
import { api, getErrorMessage, getFieldErrors } from '../../lib/api.js'
import { formatDateTime, roleLabel } from '../../lib/format.js'

const blankUser = (role) => ({
  name: '',
  email: '',
  password: '',
  role,
  rollNumber: '',
  employeeId: '',
  department: '',
  year: '',
  isActive: true,
})

function UserFormModal({ mode, initial, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const isCreate = mode === 'create'
  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      if (isCreate) {
        const { isActive: _a, ...payload } = form
        if (payload.role === 'faculty') delete payload.rollNumber
        await api.post('/admin/users', payload)
        toast.success(`${roleLabel[form.role]} account created.`)
      } else {
        const payload = {
          name: form.name,
          email: form.email,
          role: form.role,
          rollNumber: form.rollNumber,
          employeeId: form.employeeId,
          department: form.department,
          year: form.year,
          isActive: form.isActive,
        }
        await api.patch(`/admin/users/${initial._id}`, payload)
        toast.success('Account updated.')
      }
      onSaved()
    } catch (error) {
      setErrors(getFieldErrors(error))
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isCreate ? `Add ${roleLabel[form.role].toLowerCase()}` : `Edit ${initial.name}`}
      description={isCreate ? 'Share the temporary password with the user and ask them to change it.' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={saving}>
            {isCreate ? 'Create account' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-4" noValidate>
        <Select label="Role" value={form.role} onChange={set('role')} error={errors.role} hint="Administrator accounts can only be created with the seed script.">
          <option value="student">Student</option>
          <option value="faculty">Faculty</option>
        </Select>
        <Input label="Full name" required value={form.name} onChange={set('name')} error={errors.name} />
        <Input label="Email" type="email" required value={form.email} onChange={set('email')} error={errors.email} />
        {isCreate && (
          <Input
            label="Temporary password"
            type="text"
            autoComplete="off"
            required
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            hint="8+ characters with a letter and a number"
          />
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {form.role === 'student' ? (
            <Input label="Roll number" required value={form.rollNumber} onChange={set('rollNumber')} error={errors.rollNumber} />
          ) : (
            <Input label="Employee ID" value={form.employeeId} onChange={set('employeeId')} error={errors.employeeId} />
          )}
          <Input label="Department" value={form.department} onChange={set('department')} error={errors.department} />
        </div>
        {form.role === 'student' && (
          <Select label="Year" value={form.year ?? ''} onChange={set('year')} error={errors.year}>
            <option value="">Not specified</option>
            {[1, 2, 3, 4, 5, 6].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </Select>
        )}
        {!isCreate && (
          <Toggle
            label="Account active"
            description="Inactive users cannot sign in or vote. Their existing ratings are kept."
            checked={form.isActive}
            onChange={(isActive) => setForm((f) => ({ ...f, isActive }))}
          />
        )}
      </form>
    </Modal>
  )
}

function ResetPasswordModal({ user, onClose }) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const { data } = await api.post(`/admin/users/${user._id}/reset-password`, { password })
      toast.success(data.message)
      onClose()
    } catch (err) {
      setError(getFieldErrors(err).password ?? getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password — ${user.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Reset password
          </Button>
        </>
      }
    >
      <Input
        label="New temporary password"
        type="text"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={error}
        hint="The user is signed out everywhere and should change it after signing in."
      />
    </Modal>
  )
}

export default function Accounts() {
  const toast = useToast()
  const [role, setRole] = useState('student')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const debounced = useDebouncedValue(search.trim())

  const { data, error, loading, reload } = useAsync(
    () =>
      api
        .get('/admin/users', { params: { role: role || undefined, status: status || undefined, search: debounced || undefined, page } })
        .then((r) => r.data),
    [role, status, debounced, page],
  )

  const closeModal = () => setModal(null)
  const savedAndClose = () => {
    setModal(null)
    reload()
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await api.delete(`/admin/users/${modal.user._id}`)
      toast.success('Account deleted.')
      savedAndClose()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Accounts"
        description="Manage student and faculty accounts. Users can never assign themselves a role."
        actions={
          <>
            <Button variant="secondary" icon={UserPlus} onClick={() => setModal({ type: 'create', user: blankUser('faculty') })}>
              Add faculty
            </Button>
            <Button icon={UserPlus} onClick={() => setModal({ type: 'create', user: blankUser('student') })}>
              Add student
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={role}
          onChange={(value) => {
            setRole(value)
            setPage(1)
          }}
          tabs={[
            { value: 'student', label: 'Students' },
            { value: 'faculty', label: 'Faculty' },
            { value: 'admin', label: 'Admins' },
            { value: '', label: 'All' },
          ]}
        />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label className="relative block flex-1 sm:w-64">
            <span className="sr-only">Search accounts</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Name, email or ID"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <Select aria-label="Account status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
      </div>

      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : data.users.length === 0 ? (
          <EmptyState icon={UserCog} title="No accounts found" description="Adjust the filters or add a new account." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>ID</Th>
                  <Th>Department</Th>
                  <Th>Ratings</Th>
                  <Th>Last sign-in</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-slate-100 bg-white ${loading ? 'opacity-60' : ''}`}>
                {data.users.map((user) => (
                  <tr key={user._id} className="hover:bg-slate-50/60">
                    <Td>
                      <p className="font-medium text-slate-900">
                        {user.name} {!user.isActive && <Badge tone="danger">Inactive</Badge>}
                      </p>
                      <p className="text-xs text-slate-400">{user.email}</p>
                    </Td>
                    <Td>
                      <Badge tone={user.role === 'admin' ? 'warning' : user.role === 'faculty' ? 'brand' : 'neutral'}>{roleLabel[user.role]}</Badge>
                    </Td>
                    <Td className="font-mono text-xs">{user.rollNumber ?? user.employeeId ?? '—'}</Td>
                    <Td>{user.department || '—'}</Td>
                    <Td className="tabular-nums">{user.role === 'admin' ? '—' : user.votesCast}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(user.lastLoginAt)}</Td>
                    <Td>
                      {user.role === 'admin' ? (
                        <p className="text-right text-xs text-slate-400">Managed by seed script</p>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Pencil}
                            aria-label={`Edit ${user.name}`}
                            onClick={() =>
                              setModal({
                                type: 'edit',
                                user: { ...blankUser(user.role), ...user, rollNumber: user.rollNumber ?? '', employeeId: user.employeeId ?? '', department: user.department ?? '', year: user.year ?? '' },
                              })
                            }
                          />
                          <Button variant="ghost" size="sm" icon={KeyRound} aria-label={`Reset password for ${user.name}`} onClick={() => setModal({ type: 'reset', user })} />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Trash2}
                            className="text-rose-600 hover:bg-rose-50"
                            aria-label={`Delete ${user.name}`}
                            onClick={() => setModal({ type: 'delete', user })}
                          />
                        </div>
                      )}
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

      {(modal?.type === 'create' || modal?.type === 'edit') && (
        <UserFormModal key={modal.user._id ?? modal.user.role} mode={modal.type} initial={modal.user} onClose={closeModal} onSaved={savedAndClose} />
      )}
      {modal?.type === 'reset' && <ResetPasswordModal user={modal.user} onClose={closeModal} />}
      <ConfirmDialog
        open={modal?.type === 'delete'}
        title="Delete account?"
        message={`${modal?.user?.name}'s account, attendance records and ratings will be permanently removed. Prefer deactivating if you want to keep their ratings.`}
        confirmLabel="Delete account"
        loading={deleting}
        onConfirm={remove}
        onClose={closeModal}
      />
    </div>
  )
}
