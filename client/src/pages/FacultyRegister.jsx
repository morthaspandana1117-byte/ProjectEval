import { UserPlus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Input } from '../components/ui.jsx'
import { useAuth, useToast } from '../context/contexts.js'
import { useRegistrationForm } from '../hooks/useRegistrationForm.js'
import { AuthLayout } from './AuthLayout.jsx'

const EMPTY = { name: '', email: '', password: '' }

export default function FacultyRegister() {
  const { registerFaculty } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { form, update, errors, formError, submitting, handleSubmit } = useRegistrationForm(EMPTY, {
    // Only name, email and password are sent; the server assigns the faculty role.
    submit: async (values) => {
      await registerFaculty(values)
      toast.success('Your faculty account is ready.')
      navigate('/dashboard', { replace: true })
    },
  })

  return (
    <AuthLayout
      title="Faculty registration"
      subtitle="Create your faculty account with your college email."
      footer={
        <div className="space-y-2">
          <p>
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              Sign in
            </Link>
          </p>
          <p>
            Student?{' '}
            <Link to="/register/student" className="font-semibold text-brand-700 hover:underline">
              Create a student account
            </Link>
          </p>
        </div>
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
