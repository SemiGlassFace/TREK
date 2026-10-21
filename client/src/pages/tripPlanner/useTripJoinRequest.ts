import { useRef, useState } from 'react'
import { tripsApi } from '../../api/client'
import { useToast } from '../../components/shared/Toast'
import { useTranslation } from '../../i18n'
import { getApiErrorMessage } from '../../types'
import { isReadOnlyTrip } from '../dashboard/dashboardModel'

/**
 * The visitor's side of a public trip, in the planner header: ask the owner to be
 * added, or withdraw the request. For a member this is inert (`readOnly` is false)
 * and the header keeps its Share button.
 *
 * The trip payload carries the status it had when it was loaded; the local value
 * only overrides it after the user acts here, so a reload shows the server's word.
 */
export function useTripJoinRequest(tripId: number | string | undefined, trip: { is_viewer?: unknown; join_request_status?: string | null } | null | undefined) {
  const toast = useToast()
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  // State alone cannot guard a double tap: both taps run before the re-render that
  // would show `busy`, so the in-flight flag has to be readable synchronously.
  const inFlight = useRef(false)
  const [localStatus, setLocalStatus] = useState<string | null | undefined>(undefined)

  const readOnly = isReadOnlyTrip(trip)
  const joinStatus = localStatus !== undefined ? localStatus : (trip?.join_request_status ?? null)

  const run = async (call: () => Promise<unknown>, next: string | null, success: string) => {
    if (!tripId || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      await call()
      setLocalStatus(next)
      toast.success(success)
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, t('common.error')))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return {
    readOnly,
    joinStatus,
    joinBusy: busy,
    requestJoin: () => run(() => tripsApi.requestJoin(tripId!), 'pending', t('trips.joinRequests.sent')),
    cancelJoin: () => run(() => tripsApi.cancelJoinRequest(tripId!), null, t('trips.joinRequests.cancelled')),
  }
}
