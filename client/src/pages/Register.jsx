import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Input, Select } from '../components/ui.jsx'
import { useAuth, useToast } from '../context/contexts.js'
import { getErrorMessage, getFieldErrors } from '../lib/api.js'
import { AuthLayout } from './AuthLayout.jsx'

const EMPTY = { name: '', email: '', rollNumber: '', department: '', year: '', password: '', confirmPassword: '' }

export default function Register() {
  const { register } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError('')
    if (form.password !== form.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' })
      return
    }
    setSubmitting(true)
    setErrors({})
    try {
      // The server always creates student accounts; no role is sent.
      const { confirmPassword: _confirm, ...payload } = form
      await register(payload)
      toast.success('Your student account is ready.')
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setErrors(getFieldErrors(error))
      setFormError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Student registration"
      subtitle="Register with your college email and roll number."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Alert tone="info" title="This form creates a student account">
          Faculty accounts are created by an authorized administrator. If you are a faculty member, ask the event administrator
          for your login details.
        </Alert>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Input label="Full name" autoComplete="name" value={form.name} onChange={update('name')} error={errors.name} required />
        <Input
          label="College email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
          error={errors.email}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Roll number"
            value={form.rollNumber}
            onChange={update('rollNumber')}
            error={errors.rollNumber}
            placeholder="e.g. 21CS045"
            required
          />
          <Select label="Year" value={form.year} onChange={update('year')} error={errors.year}>
            <option value="">Select year</option>
            {[1, 2, 3, 4, 5].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </Select>
        </div>
        <Input label="Department" value={form.department} onChange={update('department')} error={errors.department} placeholder="e.g. Computer Science" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
            error={errors.password}
            hint="8+ characters with a letter and a number"
            required
          />
          <Input
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={update('confirmPassword')}
            error={errors.confirmPassword}
            required
          />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={submitting} icon={UserPlus}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
