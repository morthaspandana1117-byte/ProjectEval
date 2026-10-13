import { ClipboardCheck, FileText, ShieldCheck, Star, Trophy, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui.jsx'

const FEATURES = [
  {
    icon: ClipboardCheck,
    title: 'Attendance-verified voting',
    text: 'Students can vote only after the administrator marks them present for the evaluation session.',
  },
  {
    icon: Trophy,
    title: 'Two independent leaderboards',
    text: 'Student and faculty rankings are calculated separately, each from its own group’s ratings.',
  },
  {
    icon: FileText,
    title: 'Feedback that matters',
    text: 'Every rating includes a written note about what the evaluator understood from the project.',
  },
  {
    icon: ShieldCheck,
    title: 'Private and secure',
    text: 'Voter identities stay with administrators. One rating per voter per project, editable any time.',
  },
]

const STEPS = [
  { title: 'Sign in & check in', text: 'Sign in with the account the administrator created for you and get marked present at the venue.' },
  { title: 'Explore projects', text: 'Browse approved projects, their descriptions and supporting files.' },
  { title: 'Rate & reflect', text: 'Give 1–5 stars and describe what you understood. Update until voting closes.' },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" className="size-9" />
            <span className="font-display text-xl font-bold text-white">ProjectEval</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button as={Link} to="/login" variant="accent">
              Sign in
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-brand-900">
        <div className="pointer-events-none absolute -right-40 top-10 size-[32rem] rounded-full bg-amber-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-40 bottom-0 size-[28rem] rounded-full bg-brand-500/30 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-36 sm:px-6 lg:px-8 lg:pb-32 lg:pt-44">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-amber-300 ring-1 ring-white/15">
              <Star className="size-4 fill-amber-300" aria-hidden /> College Project Expo
            </p>
            <h1 className="mt-6 font-display text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
              Evaluate projects fairly. Celebrate the best ideas.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-brand-100">
              ProjectEval brings presenters, students, faculty and administrators together: submit projects, verify
              attendance, collect thoughtful ratings and publish trustworthy results.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button as={Link} to="/login" variant="accent" size="lg">
                Sign in
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-amber-600">Why ProjectEval</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Built for academic evaluation days</h2>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-slate-200 p-6 transition hover:border-brand-200 hover:shadow-md">
              <div className="inline-flex rounded-xl bg-brand-50 p-2.5 text-brand-700">
                <Icon className="size-5" aria-hidden />
              </div>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <h2 className="font-display text-3xl font-bold tracking-tight">How voting works</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-800 font-display text-lg font-bold text-white">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:px-6 lg:px-8">
        <span className="flex items-center gap-2">
          <Users className="size-4" aria-hidden /> For students, faculty and administrators
        </span>
        <span>© {new Date().getFullYear()} ProjectEval</span>
      </footer>
    </div>
  )
}
