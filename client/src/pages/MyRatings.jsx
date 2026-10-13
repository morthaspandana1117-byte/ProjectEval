import { Star } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Stars } from '../components/StarRating.jsx'
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui.jsx'
import { useAsync } from '../hooks/useAsync.js'
import { api } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'

export default function MyRatings() {
  const { data, error, loading, reload } = useAsync(() => api.get('/ratings/mine').then((r) => r.data.ratings), [])

  return (
    <div>
      <PageHeader eyebrow="Evaluator" title="My ratings" description="Every rating you have submitted. Open a project to update yours." />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Star}
            title="No ratings yet"
            description="Browse the approved projects and share what you understood."
            action={
              <Button as={Link} to="/projects">
                Browse projects
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((rating) => (
            <Card key={rating._id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-brand-700">{rating.project.projectNumber}</p>
                  <Link to={`/projects/${rating.project._id}`} className="mt-0.5 block font-semibold text-slate-900 hover:text-brand-700">
                    {rating.project.title}
                  </Link>
                </div>
                <div className="text-right">
                  <Stars value={rating.score} />
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(rating.updatedAt)}</p>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{rating.feedback}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
