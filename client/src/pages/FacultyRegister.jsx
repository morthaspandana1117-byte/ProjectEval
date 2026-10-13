import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Input } from '../components/ui.jsx'
import { useAuth, useToast } from '../context/contexts.js'
import { getErrorMessage, getFieldErrors } from '../lib/api.js'
import { AuthLayout } from './AuthLayout.jsx'

const EMPTY = { name: '', email: '', password: '' }

export default function FacultyRegister() {
  const { registerFaculty } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrors({})
    setFormError('')
    try {
      // Only name, email and password are sent; the server assigns the faculty role.
      await registerFaculty(form)
      toast.success('Your faculty account is ready.')
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setErrors(getFieldErrors(error))
      setFormError(getErrorMessage(error))
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Faculty registration"
      subtitle="Create your faculty account with your college email."
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
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Input label="Name" autoComplete="name" value={form.name} onChange={update('name')} error={errors.name} required />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
          error={errors.email}
          required
        />
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
        <Button type="submit" size="lg" className="w-full" loading={submitting} icon={UserPlus}>
          Register as Faculty
        </Button>
      </form>
    </AuthLayout>
  )
}
