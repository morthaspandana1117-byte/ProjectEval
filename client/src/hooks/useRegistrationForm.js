import { useState } from 'react'
import { getErrorMessage, getFieldErrors } from '../lib/api.js'

/**
 * Shared state for the public registration forms: field values, client-side checks,
 * server field errors, a form-level error and the submitting flag (blocks double submits).
 */
export function useRegistrationForm(initial, { validate, submit }) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setFormError('')
    const clientErrors = validate?.(form) ?? {}
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors)
      return
    }
    setSubmitting(true)
    setErrors({})
    try {
      await submit(form) // navigates away on success
    } catch (error) {
      setErrors(getFieldErrors(error))
      setFormError(getErrorMessage(error))
      setSubmitting(false)
    }
  }

  return { form, update, errors, formError, submitting, handleSubmit }
}
