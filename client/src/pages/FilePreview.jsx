import { ArrowLeft, Download, ExternalLink, FileWarning, ImageOff, Presentation } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageLoader } from '../components/ui.jsx'
import { useToast } from '../context/contexts.js'
import { useAsync } from '../hooks/useAsync.js'
import { api, downloadFile, fetchBlob, getErrorMessage } from '../lib/api.js'
import { formatBytes } from '../lib/format.js'
import { previewKind } from '../lib/filePreview.js'
import { parsePptx } from '../lib/pptx.js'

// Previews are built in the browser from the authenticated download endpoint, so files never
// become publicly reachable and the existing project permissions apply unchanged.

function useObjectUrl(blob) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => () => url && URL.revokeObjectURL(url), [url])
  return url
}

function ImagePreview({ blob, alt }) {
  const url = useObjectUrl(blob)
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <EmptyState icon={ImageOff} title="This image could not be displayed" description="Download the file to open it on your device." />
  }
  return (
    <div className="flex justify-center bg-slate-50 p-4">
      <img src={url} alt={alt} className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-sm" onError={() => setFailed(true)} />
    </div>
  )
}

function PdfPreview({ blob, filename }) {
  const url = useObjectUrl(blob)
  return (
    <div className="space-y-3 p-4">
      <iframe title={`Preview of ${filename}`} src={url} className="h-[78vh] w-full rounded-lg border border-slate-200 bg-slate-50" />
      <p className="text-xs text-slate-500">
        PDF not showing?{' '}
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
          Open it in your browser&apos;s PDF viewer <ExternalLink className="size-3" aria-hidden />
        </a>{' '}
        or download it.
      </p>
    </div>
  )
}

function SlideImage({ image }) {
  const blob = useMemo(() => new Blob([image.bytes], { type: image.type }), [image])
  const url = useObjectUrl(blob)
  return <img src={url} alt={image.name} className="max-h-72 w-full rounded-lg border border-slate-100 bg-slate-50 object-contain" />
}

function PptxPreview({ presentation }) {
  const { slides } = presentation
  if (slides.length === 0) {
    return <EmptyState icon={Presentation} title="No slides found" description="This presentation has no slides to preview. Download it to check the file." />
  }
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <Alert tone="info" title="Simplified preview">
        Shows each slide&apos;s text and pictures. Layout, fonts, charts and animations appear only in the original — download it for the full
        presentation.
      </Alert>
      {slides.map((slide) => (
        <Card key={slide.number} className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
            <span className="rounded-md bg-brand-800 px-2 py-0.5 text-xs font-semibold text-white">Slide {slide.number}</span>
            {slide.title && <h2 className="min-w-0 truncate text-base font-semibold text-slate-900">{slide.title}</h2>}
          </div>
          <div className="space-y-4 px-5 py-4">
            {slide.paragraphs.length > 0 && (
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
                {slide.paragraphs.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            )}
            {slide.images.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {slide.images.map((image) => (
                  <SlideImage key={image.name} image={image} />
                ))}
              </div>
            )}
            {slide.skippedImages > 0 && (
              <p className="text-xs text-slate-500">
                {slide.skippedImages} picture{slide.skippedImages > 1 && 's'} in a format browsers can&apos;t display (shown in the original file).
              </p>
            )}
            {!slide.title && slide.paragraphs.length === 0 && slide.images.length === 0 && slide.skippedImages === 0 && (
              <p className="text-sm text-slate-500">This slide has no text or pictures that can be previewed.</p>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}

async function loadPreview(projectId, fileId) {
  const { data } = await api.get(`/projects/${projectId}`)
  const file = data.project.files.find((f) => f._id === fileId)
  if (!file) throw new Error('This file is no longer attached to the project.')

  const kind = previewKind(file.filename)
  const base = { project: data.project, file, kind }
  if (!kind) return base

  const response = await fetchBlob(`/projects/${projectId}/files/${fileId}`)
  // The display type comes from the upload allow-list, not from the response.
  const blob = new Blob([response.data], { type: kind.type })
  try {
    if (kind.kind === 'pptx') return { ...base, presentation: await parsePptx(await blob.arrayBuffer()) }
    return { ...base, blob }
  } catch (error) {
    return { ...base, previewError: error.message || 'The file could not be read.' }
  }
}

export default function FilePreview() {
  const { id, fileId } = useParams()
  const toast = useToast()
  const [downloading, setDownloading] = useState(false)
  const { data, error, loading, reload } = useAsync(() => loadPreview(id, fileId), [id, fileId])

  const handleDownload = async () => {
    setDownloading(true)
    try {
      await downloadFile(`/projects/${id}/files/${fileId}`, data?.file.filename)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setDownloading(false)
    }
  }

  if (loading && !data) return <PageLoader label="Preparing preview…" />
  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={reload} title="Preview unavailable" />
        <div className="flex justify-center pb-8">
          <Button as={Link} to={`/projects/${id}`} variant="secondary" icon={ArrowLeft}>
            Back to project
          </Button>
        </div>
      </Card>
    )
  }

  const { project, file, kind, blob, presentation, previewError } = data
  const downloadButton = (
    <Button icon={Download} loading={downloading} onClick={handleDownload}>
      Download
    </Button>
  )

  let content
  if (!kind) {
    content = (
      <EmptyState
        icon={FileWarning}
        title="Preview isn't available for this file type"
        description="This kind of file can't be shown in the browser. Download it to open it on your device."
        action={downloadButton}
      />
    )
  } else if (previewError) {
    content = (
      <EmptyState icon={FileWarning} title="We couldn't preview this file" description={`${previewError} You can still download it.`} action={downloadButton} />
    )
  } else if (kind.kind === 'pptx') {
    content = <PptxPreview presentation={presentation} />
  } else if (kind.kind === 'pdf') {
    content = <PdfPreview blob={blob} filename={file.filename} />
  } else {
    content = <ImagePreview blob={blob} alt={file.filename} />
  }

  return (
    <div>
      <PageHeader
        eyebrow="File preview"
        title={file.filename}
        description={`${project.projectNumber} · ${project.title} · ${formatBytes(file.size)}`}
        actions={
          <>
            <Button as={Link} to={`/projects/${id}`} variant="secondary" icon={ArrowLeft}>
              Back to project
            </Button>
            {downloadButton}
          </>
        }
      />
      <Card className="overflow-hidden">
        <CardHeader title="Preview" description="Opened securely with your ProjectEval session" />
        {content}
      </Card>
    </div>
  )
}
