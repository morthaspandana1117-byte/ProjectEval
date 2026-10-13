import { CalendarClock, CheckCircle2, Lock } from 'lucide-react'
import { Badge } from './ui.jsx'

// All open/closed decisions come from the server's deadline summary (never the browser clock).

const ITEMS = [
  { key: 'submission', label: 'New submissions' },
  { key: 'edit', label: 'Editing & deleting projects' },
  { key: 'upload', label: 'Uploading & removing files' },
]

const tzLabel = (deadlines) => (deadlines?.eventTimezone === 'Asia/Kolkata' ? 'IST' : deadlines?.eventTimezone)

function statusText(item, key) {
  if (key === 'submission' && !item.switchOn) return 'Closed by the administrator'
  if (item.invalid) return 'Closed — deadline misconfigured'
  if (!item.configured) return 'No deadline — open indefinitely'
  return item.open ? `Open until ${item.display}` : `Closed since ${item.display}`
}

/** Compact list of the three presenter deadlines. */
export function DeadlineList({ deadlines, compact = false }) {
  if (!deadlines) return null
  return (
    <ul className={compact ? 'space-y-2' : 'divide-y divide-slate-100'}>
      {ITEMS.map(({ key, label }) => {
        const item = deadlines[key]
        const Icon = item.open ? (item.configured ? CalendarClock : CheckCircle2) : Lock
        return (
          <li key={key} className={`flex items-start gap-3 ${compact ? '' : 'px-5 py-3'}`}>
            <Icon className={`mt-0.5 size-4 shrink-0 ${item.open ? 'text-emerald-600' : 'text-rose-500'}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{label}</p>
              <p className="text-xs text-slate-500">{statusText(item, key)}</p>
            </div>
            <Badge tone={item.open ? 'success' : 'danger'}>{item.open ? 'Open' : 'Closed'}</Badge>
          </li>
        )
      })}
    </ul>
  )
}

export function TimezoneNote({ deadlines }) {
  if (!deadlines) return null
  return <p className="text-xs text-slate-500">All times are in {deadlines.eventTimezone} ({tzLabel(deadlines)}).</p>
}
