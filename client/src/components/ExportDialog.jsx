import { Download, FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../context/contexts.js'
import { downloadFile, getErrorMessage } from '../lib/api.js'
import { Button, Modal } from './ui.jsx'

function ChoiceGroup({ legend, name, options, value, onChange }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-800">{legend}</legend>
      <div className="space-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
              value === option.value ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-4 accent-brand-700"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">{option.label}</span>
              {option.hint && <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Lets the admin choose export options before downloading.
 * `fields`: [{ name, legend, options }] · `describe(values)` → { url, filename }.
 */
export function ExportDialog({ open, onClose, title, description, fields, initialValues, describe }) {
  const toast = useToast()
  const [values, setValues] = useState(initialValues)
  const [downloading, setDownloading] = useState(false)
  const { url, filename } = describe(values)

  const download = async () => {
    setDownloading(true)
    try {
      await downloadFile(url, filename)
      toast.success(`Downloaded ${filename}`)
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={downloading}>
            Cancel
          </Button>
          <Button icon={Download} loading={downloading} onClick={download}>
            Download .xlsx
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {fields.map((field) => (
          <ChoiceGroup
            key={field.name}
            legend={field.legend}
            name={field.name}
            options={field.options}
            value={values[field.name]}
            onChange={(value) => setValues((v) => ({ ...v, [field.name]: value }))}
          />
        ))}
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <FileSpreadsheet className="size-5 shrink-0 text-emerald-600" aria-hidden />
          <p className="min-w-0 text-slate-600">
            You will download <span className="break-all font-mono text-xs font-semibold text-slate-900">{filename}</span>
          </p>
        </div>
      </div>
    </Modal>
  )
}
