import { CheckCircle2, GraduationCap, Paperclip, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatRating } from '../lib/format.js'
import { Badge, Card, StatusBadge } from './ui.jsx'

export function ProjectCard({ project, showStatus = false }) {
  return (
    <Card className="group relative flex h-full flex-col p-5 transition hover:border-brand-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <Badge tone="brand" className="font-mono">
          {project.projectNumber}
        </Badge>
        {showStatus ? (
          <StatusBadge status={project.status} />
        ) : project.isOwn ? (
          <Badge tone="neutral">Your project</Badge>
        ) : project.myScore ? (
          <Badge tone="success">
            <CheckCircle2 className="size-3.5" aria-hidden /> Rated {project.myScore}/5
          </Badge>
        ) : null}
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-snug text-slate-900">
        <Link to={`/projects/${project._id}`} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-500 group-hover:text-brand-700">
          {project.title}
        </Link>
      </h3>
      <p className="mb-4 mt-2 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-slate-500">
        {project.description || project.abstract}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Users className="size-3.5" aria-hidden /> {project.teamMembers.length} member{project.teamMembers.length !== 1 && 's'}
        </span>
        {project.facultyGuide && (
          <span className="flex items-center gap-1">
            <GraduationCap className="size-3.5" aria-hidden /> {project.facultyGuide}
          </span>
        )}
        {project.fileCount > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip className="size-3.5" aria-hidden /> {project.fileCount}
          </span>
        )}
      </div>

      {project.stats && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {['student', 'faculty', 'overall'].map((group) => (
            <div key={group} className="rounded-lg bg-slate-50 px-2.5 py-2">
              <p className="font-medium capitalize text-slate-600">{group}</p>
              <p className="mt-0.5 text-slate-500">
                <span className="font-semibold tabular-nums text-slate-900">{formatRating(project.stats[group].averageRating)}</span> (
                {project.stats[group].voteCount})
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
