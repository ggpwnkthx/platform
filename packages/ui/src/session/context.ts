import { createContext, useContext } from 'react'
import type { Gate, Ready } from './types.ts'

export const GateContext = createContext<Gate | null>(null)
export const ReadyContext = createContext<Ready | null>(null)
export const useGate = () => useContext(GateContext)!
export function useSession(): Ready {
  const session = useContext(ReadyContext)
  if (!session) throw new Error('Sign in first.')
  return session
}
