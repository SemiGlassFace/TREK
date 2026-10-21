import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePermissionsStore, useCanDo } from '../../../src/store/permissionsStore';
import { useAuthStore } from '../../../src/store/authStore';
import { resetAllStores } from '../../helpers/store';
import { buildUser, buildAdmin } from '../../helpers/factories';

beforeEach(() => {
  resetAllStores();
});

describe('permissionsStore', () => {
  describe('FE-PERMS-001: setPermissions()', () => {
    it('stores the permission map', () => {
      const perms = { trip_create: 'everybody', file_upload: 'trip_member' } as const;
      usePermissionsStore.getState().setPermissions(perms);

      expect(usePermissionsStore.getState().permissions).toEqual(perms);
    });
  });

  describe('FE-PERMS-002: useCanDo() — basic allow/deny', () => {
    it('returns false when user is not authenticated', () => {
      usePermissionsStore.getState().setPermissions({ trip_create: 'everybody' });

      const { result } = renderHook(() => useCanDo());
      expect(result.current('trip_create')).toBe(false);
    });

    it('returns true for "everybody" when user is authenticated', () => {
      useAuthStore.setState({ user: buildUser(), isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({ trip_create: 'everybody' });

      const { result } = renderHook(() => useCanDo());
      expect(result.current('trip_create')).toBe(true);
    });

    it('returns true when action has no configured permission (default allow)', () => {
      useAuthStore.setState({ user: buildUser(), isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({});

      const { result } = renderHook(() => useCanDo());
      expect(result.current('unconfigured_action')).toBe(true);
    });
  });

  describe('Admin user', () => {
    it('can do anything regardless of configured permissions', () => {
      useAuthStore.setState({ user: buildAdmin(), isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({ restricted_action: 'admin' });

      const { result } = renderHook(() => useCanDo());
      expect(result.current('restricted_action')).toBe(true);
    });
  });

  describe('Owner permissions', () => {
    it('trip_owner level: owner can act, member cannot', () => {
      const user = buildUser({ id: 42 });
      useAuthStore.setState({ user, isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({ delete_trip: 'trip_owner' });

      const { result } = renderHook(() => useCanDo());
      const trip = { owner_id: 42 };      // user is owner
      const otherTrip = { owner_id: 99 }; // user is not owner

      expect(result.current('delete_trip', trip)).toBe(true);
      expect(result.current('delete_trip', otherTrip)).toBe(false);
    });

    it('trip_owner level: is_owner flag grants access', () => {
      const user = buildUser({ id: 1 });
      useAuthStore.setState({ user, isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({ delete_trip: 'trip_owner' });

      const { result } = renderHook(() => useCanDo());
      expect(result.current('delete_trip', { is_owner: true })).toBe(true);
      expect(result.current('delete_trip', { is_owner: false })).toBe(false);
    });
  });

  describe('Member permissions', () => {
    it('trip_member level: members and owners can act, unauthenticated trip context cannot', () => {
      const user = buildUser({ id: 1 });
      useAuthStore.setState({ user, isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({ upload_file: 'trip_member' });

      const { result } = renderHook(() => useCanDo());
      const asOwner = { owner_id: 1 };       // user is owner
      const asMember = { owner_id: 99 };     // user is member (trip context provided, not owner)
      const noTrip = null;                   // no trip context

      expect(result.current('upload_file', asOwner)).toBe(true);
      expect(result.current('upload_file', asMember)).toBe(true);
      expect(result.current('upload_file', noTrip)).toBe(false);
    });
  });

  describe('Nobody / admin-only level', () => {
    it('admin level: regular user is denied even as trip owner', () => {
      const user = buildUser({ id: 1 });
      useAuthStore.setState({ user, isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({ admin_action: 'admin' });

      const { result } = renderHook(() => useCanDo());
      expect(result.current('admin_action', { owner_id: 1 })).toBe(false);
      expect(result.current('admin_action')).toBe(false);
    });
  });

  describe('Visitor of a public trip (is_viewer)', () => {
    const publicTrip = { user_id: 99, is_owner: 0, is_viewer: 1 };

    it('can do nothing, whatever the setting says', () => {
      useAuthStore.setState({ user: buildUser(), isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({ day_edit: 'everybody', place_edit: 'trip_member' });

      const { result } = renderHook(() => useCanDo());
      expect(result.current('day_edit', publicTrip)).toBe(false);
      expect(result.current('place_edit', publicTrip)).toBe(false);
      // not configured = allow, except for a visitor
      expect(result.current('budget_edit', publicTrip)).toBe(false);
    });

    it('is refused even as an admin — the server refuses their writes on it too', () => {
      useAuthStore.setState({ user: buildAdmin(), isAuthenticated: true });
      const { result } = renderHook(() => useCanDo());
      expect(result.current('day_edit', publicTrip)).toBe(false);
      // …while the same admin keeps their reach everywhere else
      expect(result.current('day_edit', { user_id: 99, is_viewer: 0 })).toBe(true);
      expect(result.current('trip_create')).toBe(true);
    });

    it('does not affect a member of the same trip', () => {
      useAuthStore.setState({ user: buildUser(), isAuthenticated: true });
      usePermissionsStore.getState().setPermissions({ day_edit: 'trip_member' });
      const { result } = renderHook(() => useCanDo());
      expect(result.current('day_edit', { user_id: 99, is_owner: 0, is_viewer: 0 })).toBe(true);
    });
  });
});
