import { useCallback, useEffect, useRef, useState } from 'react'
import { shiftApi } from '../../api/shiftApi'
import type { CashMovement, Shift, ShiftSummary } from '../../types'
import { getErrorMessage } from '../../utils/errors'

type Snapshot = {
  shift: Shift | null
  summary: ShiftSummary | null
  movements: CashMovement[] | null
  summaryError: string | null
  movementsError: string | null
  updatedAt: string | null
}
const empty = (shift: Shift | null): Snapshot => ({ shift, summary: null, movements: null, summaryError: null, movementsError: null, updatedAt: null })

/** Keep each drawer and cash log attached to its shift; only the latest refresh can commit. */
export function useMyShift() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const token = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const shift = await shiftApi.getActive()
      if (!shift) {
        if (token === generation.current) setSnapshot(empty(null))
        return
      }
      const [drawer, log] = await Promise.allSettled([shiftApi.summary(), shiftApi.movements(shift.id)])
      if (token !== generation.current) return
      if (drawer.status === 'fulfilled' && drawer.value.shift.id !== shift.id) throw new Error('Active shift changed')
      setSnapshot(previous => {
        const sameShift = previous?.shift?.id === shift.id
        return {
          shift,
          summary: drawer.status === 'fulfilled' ? drawer.value.summary : sameShift ? previous.summary : null,
          movements: log.status === 'fulfilled' ? log.value : sameShift ? previous.movements : null,
          summaryError: drawer.status === 'rejected' ? getErrorMessage(drawer.reason) : null,
          movementsError: log.status === 'rejected' ? getErrorMessage(log.reason) : null,
          updatedAt: drawer.status === 'fulfilled' ? new Date().toISOString() : sameShift ? previous.updatedAt : null,
        }
      })
    } catch (error) {
      if (token === generation.current) setError(getErrorMessage(error))
    } finally {
      if (token === generation.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload()
    return () => { generation.current += 1 }
  }, [reload])
  function commit(shift: Shift | null) {
    generation.current += 1
    setSnapshot(empty(shift))
    setLoading(false)
    setError(null)
    if (shift) void reload()
  }
  return { snapshot, loading, error, reload, commit }
}
