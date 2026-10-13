import { Star } from 'lucide-react'
import { useState } from 'react'

const LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent']

export function StarRating({ value, onChange, disabled, size = 'lg' }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  const iconSize = size === 'lg' ? 'size-8' : 'size-5'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="radiogroup" aria-label="Rating" className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={`${score} star${score > 1 ? 's' : ''} — ${LABELS[score - 1]}`}
            disabled={disabled}
            onMouseEnter={() => setHover(score)}
            onClick={() => onChange(score)}
            className="rounded-md p-0.5 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <Star className={`${iconSize} ${score <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
          </button>
        ))}
      </div>
      {shown > 0 && <span className="text-sm font-medium text-slate-600">{LABELS[shown - 1]}</span>}
    </div>
  )
}

export function Stars({ value, className = 'size-4' }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value == null ? 'No rating' : `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = value == null ? 0 : Math.max(0, Math.min(1, value - (n - 1)))
        return (
          <span key={n} className="relative inline-block">
            <Star className={`${className} text-slate-200`} aria-hidden />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={`${className} fill-amber-400 text-amber-400`} aria-hidden />
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
