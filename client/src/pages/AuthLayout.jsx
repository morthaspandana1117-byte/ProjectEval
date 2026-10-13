import { Link } from 'react-router-dom'

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-brand-500/30 blur-3xl" />
        <Link to="/" className="relative flex items-center gap-3">
          <img src="/logo.svg" alt="" className="size-11" />
          <span className="font-display text-2xl font-bold text-white">ProjectEval</span>
        </Link>
        <div className="relative">
          <blockquote className="font-display text-3xl font-semibold leading-snug text-white">
            “Fair, transparent evaluation for every project on display.”
          </blockquote>
          <p className="mt-4 max-w-md text-brand-200">
            Separate student and faculty leaderboards, attendance-verified voting and meaningful written feedback.
          </p>
        </div>
        <p className="relative text-sm text-brand-300">© {new Date().getFullYear()} ProjectEval</p>
      </div>

      <div className="flex flex-col justify-center px-4 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-8 flex items-center gap-2 lg:hidden">
            <img src="/logo.svg" alt="" className="size-9" />
            <span className="font-display text-xl font-bold text-brand-900">ProjectEval</span>
          </Link>
          <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-slate-600">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
