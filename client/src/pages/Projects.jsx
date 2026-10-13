import { FolderKanban, Search } from 'lucide-react'
import { useState } from 'react'
import { ProjectCard } from '../components/ProjectCard.jsx'
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Select, Skeleton } from '../components/ui.jsx'
import { useAuth } from '../context/contexts.js'
import { useAsync } from '../hooks/useAsync.js'
import { useDebouncedValue } from '../hooks/useDebouncedValue.js'
import { api } from '../lib/api.js'

export default function Projects() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(isAdmin ? 'approved' : '')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search.trim())

  const { data, error, loading, reload } = useAsync(
    () =>
      api
        .get('/projects', { params: { search: debouncedSearch || undefined, status: status || undefined, page } })
        .then((r) => r.data),
    [debouncedSearch, status, page],
  )

  const changeFilter = (setter) => (event) => {
    setter(event.target.value)
    setPage(1)
  }

  const filtered = Boolean(debouncedSearch)

  return (
    <div>
      <PageHeader
        eyebrow="Project gallery"
        title="Projects"
        description={isAdmin ? 'Browse every submission with group-wise rating summaries.' : 'Explore approved projects and share your evaluation.'}
      />

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="relative block">
            <span className="sr-only">Search projects</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={changeFilter(setSearch)}
              placeholder="Search by title, number or description"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          {isAdmin && (
            <Select aria-label="Filter by status" value={status} onChange={changeFilter(setStatus)} className="sm:w-44">
              <option value="">All statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Changes requested</option>
            </Select>
          )}
        </div>
      </Card>

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : loading && !data ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : data.projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderKanban}
            title={filtered ? 'No matching projects' : 'No projects yet'}
            description={filtered ? 'Try a different search term.' : 'Approved projects will be listed here.'}
          />
        </Card>
      ) : (
        <>
          <div className={`grid gap-5 sm:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {data.projects.map((project) => (
              <div key={project._id} className="relative">
                <ProjectCard project={project} showStatus={isAdmin} />
              </div>
            ))}
          </div>
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      )}
    </div>
  )
}
