import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui.jsx'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 rounded-full bg-brand-50 p-4 text-brand-600">
        <Compass className="size-8" aria-hidden />
      </div>
      <p className="text-sm font-semibold uppercase tracking-wider text-amber-600">Error 404</p>
      <h1 className="mt-2 font-display text-3xl font-bold">Page not found</h1>
      <p className="mt-2 max-w-md text-slate-500">The page you are looking for does not exist or may have moved.</p>
      <Button as={Link} to="/" className="mt-6">
        Go to home page
      </Button>
    </div>
  )
}
