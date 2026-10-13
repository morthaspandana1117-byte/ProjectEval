import axios from 'axios'

export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 30000,
})

// Let the auth layer react when the session expires mid-use.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url ?? ''
    if (error.response?.status === 401 && !url.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('auth:expired'))
    }
    return Promise.reject(error)
  },
)

export function getErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (error?.response?.data?.message) return error.response.data.message
  if (error?.code === 'ECONNABORTED') return 'The server took too long to respond. Please try again.'
  if (error?.request && !error.response) return 'Cannot reach the server. Check your connection and try again.'
  return error?.message || fallback
}

export function getFieldErrors(error) {
  return error?.response?.data?.errors ?? {}
}

/** Downloads an authenticated file (exports, attachments) and surfaces JSON errors properly. */
export async function downloadFile(url, fallbackName = 'download') {
  try {
    const response = await api.get(url, { responseType: 'blob' })
    const disposition = response.headers['content-disposition'] ?? ''
    const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition)
    const filename = match ? decodeURIComponent(match[1] ?? match[2]) : fallbackName
    const href = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  } catch (error) {
    const blob = error?.response?.data
    if (blob instanceof Blob) {
      try {
        error.response.data = JSON.parse(await blob.text())
      } catch {
        /* keep the original error */
      }
    }
    throw error
  }
}
