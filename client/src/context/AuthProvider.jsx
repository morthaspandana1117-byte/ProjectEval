import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { AuthContext } from './contexts.js'

export function AuthProvider({ children }) {
  const [session, setSession] = useState({ status: 'loading', user: null, settings: null, eligibility: null, deadlines: null })

  const applySession = useCallback((data) => {
    setSession({
      status: 'ready',
      user: data.user,
      settings: data.settings,
      eligibility: data.eligibility,
      deadlines: data.deadlines ?? null,
    })
  }, [])

  const clearSession = useCallback(() => {
    setSession({ status: 'ready', user: null, settings: null, eligibility: null, deadlines: null })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me')
      applySession(data)
    } catch {
      clearSession()
    }
  }, [applySession, clearSession])

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => applySession(data), clearSession)
    window.addEventListener('auth:expired', clearSession)
    return () => window.removeEventListener('auth:expired', clearSession)
  }, [applySession, clearSession])

  const login = useCallback(
    async (credentials) => {
      const { data } = await api.post('/auth/login', credentials)
      applySession(data)
      return data.user
    },
    [applySession],
  )

  const register = useCallback(
    async (payload) => {
      const { data } = await api.post('/auth/register', payload)
      applySession(data)
      return data.user
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      clearSession()
    }
  }, [clearSession])

  const value = useMemo(
    () => ({ ...session, loading: session.status === 'loading', login, register, logout, refresh }),
    [session, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
