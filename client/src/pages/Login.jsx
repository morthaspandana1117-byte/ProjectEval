import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Input } from '../components/ui.jsx'
import { useAuth, useToast } from '../context/contexts.js'
import { getErrorMessage, getFieldErrors } from '../lib/api.js'
import { AuthLayout } from './AuthLayout.jsx'

export default function Login() {
  const { login } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setErrors({})
    setFormError('')
    try {
      const user = await login(form)
      toast.success(`Welcome back, ${user.name.split(' ')[0]}!`)
      navigate(location.state?.from ?? '/dashboard', { replace: true })
    } catch (error) {
      setErrors(getFieldErrors(error))
      setFormError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the account created for you by the event administrator."
      footer={
        <div className="space-y-2">
          <p>
            Faculty member?{' '}
            <Link to="/register/faculty" className="font-semibold text-brand-700 hover:underline">
              Register as Faculty
            </Link>
          </p>
          <p>Students: ask the event administrator to create your account.</p>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Input
          label="College email"
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
          autoComplete="current-password"
          value={form.password}
          onChange={update('password')}
          error={errors.password}
          required
        />
        <Button type="submit" size="lg" className="w-full" loading={submitting} icon={LogIn}>
          Sign in
        </Button>
        <p className="text-center text-xs text-slate-500">Forgot your password? Ask the event administrator to reset it.</p>
      </form>
    </AuthLayout>
  )
}
