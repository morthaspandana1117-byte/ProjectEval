import { UserPlus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Input, Select } from '../components/ui.jsx'
import { useAuth, useToast } from '../context/contexts.js'
import { useRegistrationForm } from '../hooks/useRegistrationForm.js'
import { DEPARTMENT_MAX, validateStudentProfile, YEAR_OPTIONS, yearLabel } from '../lib/academic.js'
import { AuthLayout } from './AuthLayout.jsx'

const EMPTY = { name: '', email: '', rollNumber: '', department: '', year: '', password: '', confirmPassword: '' }

function validate({ name, email, rollNumber, department, year, password, confirmPassword }) {
  const errors = {}
  if (!name.trim()) errors.name = 'Full name is required'
  if (!email.trim()) errors.email = 'Email is required'
  if (!rollNumber.trim()) errors.rollNumber = 'Roll number is required'
  Object.assign(errors, validateStudentProfile({ department, year }))
  if (!password) errors.password = 'Password is required'
  if (!confirmPassword) errors.confirmPassword = 'Please confirm your password'
  else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match'
  return errors
}

export default function StudentRegister() {
  const { registerStudent } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { form, update, errors, formError, submitting, handleSubmit } = useRegistrationForm(EMPTY, {
    validate,
    // The server assigns the student role; no role is sent.
    submit: async (values) => {
      const { message, user } = await registerStudent(values)
      toast.success(message)
      navigate('/login', { replace: true, state: { registeredEmail: user.email } })
    },
  })

  return (
    <AuthLayout
      title="Student registration"
      subtitle="Create your student account, then sign in to explore and rate projects."
      footer={
        <div className="space-y-2">
          <p>
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              Sign in
            </Link>
          </p>
          <p>
            Faculty member?{' '}
            <Link to="/register/faculty" className="font-semibold text-brand-700 hover:underline">
              Register as Faculty
            </Link>
          </p>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Input label="Full name" autoComplete="name" value={form.name} onChange={update('name')} error={errors.name} required />
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
          label="Roll number"
          autoComplete="off"
          value={form.rollNumber}
          onChange={update('rollNumber')}
          error={errors.rollNumber}
          placeholder="e.g. 21CS045"
          hint="Your college roll number. Letters, numbers, - / _ only."
          maxLength={30}
          required
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Department"
            value={form.department}
            onChange={update('department')}
            error={errors.department}
            placeholder="e.g. Computer Science"
            maxLength={DEPARTMENT_MAX}
            required
          />
          <Select label="Year of study" value={form.year} onChange={update('year')} error={errors.year} required>
            <option value="">Select year</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {yearLabel(y)}
              </option>
            ))}
          </Select>
        </div>
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
        <Button type="submit" size="lg" className="w-full" loading={submitting} icon={UserPlus}>
          Create student account
        </Button>
      </form>
    </AuthLayout>
  )
}
