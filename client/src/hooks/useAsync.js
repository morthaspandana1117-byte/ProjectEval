import { useCallback, useEffect, useState } from 'react'

/**
 * Runs an async loader whenever `deps` change.
 * `loading` is true until data for the current deps arrives; stale data stays visible meanwhile.
 */
export function useAsync(loader, deps = []) {
  const [nonce, setNonce] = useState(0)
  const key = JSON.stringify([...deps, nonce])
  const [state, setState] = useState({ key: null, data: null, error: null })

  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(loader)
      .then(
        (data) => active && setState({ key, data, error: null }),
        (error) => active && setState((prev) => ({ key, data: prev.data, error })),
      )
    return () => {
      active = false
    }
    // `key` captures every dependency; the loader closure is intentionally read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const setData = useCallback((updater) => {
    setState((prev) => ({ ...prev, data: typeof updater === 'function' ? updater(prev.data) : updater }))
  }, [])

  return {
    data: state.data,
    error: state.key === key ? state.error : null,
    loading: state.key !== key,
    reload,
    setData,
  }
}
