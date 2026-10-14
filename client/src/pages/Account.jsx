import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardHeader, Input, PageHeader } from '../components/ui.jsx'
import { useAuth, useToast } from '../context/contexts.js'
import { api, getErrorMessage, getFieldErrors } from '../lib/api.js'
import { roleLabel } from '../lib/format.js'

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' }

export default function Account() {
  const { user } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (form.newPassword !== form.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' })
      return
    }
    setSaving(true)
    setErrors({})
    try {
      await api.patch('/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword })
      toast.success('Password updated. Other devices have been signed out.')
      setForm(EMPTY)
    } catch (error) {
      setErrors(getFieldErrors(error))
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const details = [
    ['Name', user.name],
    ['Email', user.email],
    ['Role', roleLabel[user.role]],
    user.rollNumber && ['Roll number', user.rollNumber],
    user.employeeId && ['Employee ID', user.employeeId],
    user.department && ['Department', user.department],
    user.year && ['Year', `Year ${user.year}`],
  ].filter(Boolean)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My account" description="Profile details are managed by the administrator." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" />
          <dl className="divide-y divide-slate-100">
            {details.map(([label, value]) => (
              <div key={label} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-3">
                <dt className="text-sm text-slate-500">{label}</dt>
                <dd className="text-sm font-medium text-slate-900 sm:col-span-2">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Change password" description="Changing your password signs you out on other devices." />
          <form onSubmit={handleSubmit} className="space-y-4 p-5" noValidate>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={set('currentPassword')}
              error={errors.currentPassword}
              required
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                value={form.newPassword}
                onChange={set('newPassword')}
                error={errors.newPassword}
                hint="8+ characters with a letter and a number"
                required
              />
              <Input
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={set('confirmPassword')}
                error={errors.confirmPassword}
                required
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={saving} icon={KeyRound}>
                Update password
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
