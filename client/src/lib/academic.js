// Student profile fields shared by student registration and the admin account form.
// Must match the server rules in server/src/utils/schemas.js (YEAR_OPTIONS, DEPARTMENT_MAX).
export const YEAR_OPTIONS = [1, 2, 3, 4, 5, 6]
export const DEPARTMENT_MAX = 100
export const yearLabel = (year) => `Year ${year}`

/** Client-side checks for a student's Department and Year of Study (server validates again). */
export function validateStudentProfile({ department, year }) {
  const errors = {}
  const dept = (department ?? '').trim()
  if (!dept) errors.department = 'Department is required'
  else if (dept.length > DEPARTMENT_MAX) errors.department = `Department must be at most ${DEPARTMENT_MAX} characters`
  if (!YEAR_OPTIONS.includes(Number(year))) errors.year = 'Select a year of study from Year 1 to Year 6'
  return errors
}
