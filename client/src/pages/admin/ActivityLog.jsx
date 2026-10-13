import { History } from 'lucide-react'
import { useState } from 'react'
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Table, Td, Th } from '../../components/ui.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { api } from '../../lib/api.js'
import { formatDateTime, roleLabel } from '../../lib/format.js'

export default function ActivityLog() {
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/audit-logs', { params: { page } }).then((r) => r.data), [page])

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Activity log" description="An audit trail of registrations, account changes, reviews, attendance and exports." />
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : data.logs.length === 0 ? (
          <EmptyState icon={History} title="No activity recorded yet" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Action</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-slate-100 bg-white ${loading ? 'opacity-60' : ''}`}>
                {data.logs.map((log) => (
                  <tr key={log._id}>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(log.createdAt)}</Td>
                    <Td>
                      <p className="font-medium text-slate-900">{log.actor?.name ?? 'System'}</p>
                      {log.actor && <p className="text-xs text-slate-400">{roleLabel[log.actor.role]}</p>}
                    </Td>
                    <Td>
                      <Badge tone="brand" className="font-mono">
                        {log.action}
                      </Badge>
                    </Td>
                    <Td className="text-slate-600">{log.summary ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="px-4">
              <Pagination pagination={data.pagination} onPage={setPage} />
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
