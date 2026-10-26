import { create } from 'zustand'
import { useAuthStore } from './authStore'

export type PermissionLevel = 'admin' | 'trip_owner' | 'trip_member' | 'everybody'

/** Minimal trip shape used by permission checks — accepts both Trip and DashboardTrip */
type TripOwnerContext = { user_id?: unknown; owner_id?: unknown; is_owner?: unknown; is_viewer?: unknown }

interface PermissionsState {
  permissions: Record<string, PermissionLevel>
  setPermissions: (perms: Record<string, PermissionLevel>) => void
}

/** The server sends a flag as 1/0 in some payloads and true/false in others. */
const isFlag = (value: unknown) => value === true || value === 1

export const usePermissionsStore = create<PermissionsState>((set) => ({
  permissions: {},
  setPermissions: (perms) => set({ permissions: perms }),
}))

/**
 * Hook that returns a permission checker bound to the current user.
 * Usage: const can = useCanDo(); can('trip_create') or can('file_upload', trip)
 */
export function useCanDo() {
  const perms = usePermissionsStore((s: PermissionsState) => s.permissions)
  const user = useAuthStore((s) => s.user)

  return function can(
    actionKey: string,
    trip?: TripOwnerContext | null,
  ): boolean {
    // A visitor of someone's public trip edits nothing — admins included, which is
    // why this sits above the admin shortcut: the server refuses their writes too.
    if (!user || isFlag(trip?.is_viewer)) return false
    if (user.role === 'admin') return true

    const level = perms[actionKey]
    if (!level) return true // not configured = allow

    // Support both Trip (owner_id) and DashboardTrip/server response (user_id)
    const tripOwnerId = (trip?.user_id as number | undefined) ?? (trip?.owner_id as number | undefined) ?? null
    const isOwnerFlag = isFlag(trip?.is_owner)
    const isOwner = isOwnerFlag || (tripOwnerId !== null && tripOwnerId === user.id)
    const isMember = !isOwner && trip != null

    switch (level) {
      case 'admin': return false
      case 'trip_owner': return isOwner
      case 'trip_member': return isOwner || isMember
      case 'everybody': return true
      default: return false
    }
  }
}

