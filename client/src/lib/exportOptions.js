// Layout choices shared by the admin Excel exports.
export const LAYOUT_OPTIONS = [
  { value: 'none', label: 'All in one sheet', hint: 'Every record on a single worksheet (original layout).' },
  {
    value: 'year',
    label: 'Group by year',
    hint: 'Separate worksheets for 1st–4th year (and higher years if present). Records without a valid year go to an “Unassigned Year” sheet.',
  },
]
