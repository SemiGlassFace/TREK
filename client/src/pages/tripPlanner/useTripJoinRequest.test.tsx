import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/helpers/msw/server';
import { resetAllStores } from '../../../tests/helpers/store';
import { TranslationProvider } from '../../i18n/TranslationContext';
import { useTripJoinRequest } from './useTripJoinRequest';

// FE-HOOK-TJR-001 onwards

const wrapper = ({ children }: { children: React.ReactNode }) => <TranslationProvider>{children}</TranslationProvider>;

let toasts: Array<[string, string | undefined]>;

beforeEach(() => {
  resetAllStores();
  toasts = [];
  window.__addToast = ((message: string, type?: string) => { toasts.push([message, type]); return 1; }) as unknown as typeof window.__addToast;
});
afterEach(() => { delete window.__addToast; });

describe('useTripJoinRequest', () => {
  it('FE-HOOK-TJR-001: is inert for the owner and for members', () => {
    const { result } = renderHook(() => useTripJoinRequest(5, { is_viewer: 0, join_request_status: null }), { wrapper });
    expect(result.current.readOnly).toBe(false);
  });

  it('FE-HOOK-TJR-002: reads the status the trip was loaded with', () => {
    const { result } = renderHook(() => useTripJoinRequest(5, { is_viewer: 1, join_request_status: 'pending' }), { wrapper });
    expect(result.current.readOnly).toBe(true);
    expect(result.current.joinStatus).toBe('pending');
  });

  it('FE-HOOK-TJR-003: asking sends the request, turns pending and confirms', async () => {
    let asked = 0;
    server.use(http.post('/api/trips/5/join-request', () => { asked += 1; return HttpResponse.json({ status: 'pending' }); }));
    const { result } = renderHook(() => useTripJoinRequest(5, { is_viewer: 1, join_request_status: null }), { wrapper });

    await act(async () => { await result.current.requestJoin(); });

    expect(asked).toBe(1);
    expect(result.current.joinStatus).toBe('pending');
    expect(toasts.at(-1)?.[1]).toBe('success');
    expect(result.current.joinBusy).toBe(false);
  });

  it('FE-HOOK-TJR-004: withdrawing clears the status even though the loaded trip said pending', async () => {
    server.use(http.delete('/api/trips/5/join-request', () => HttpResponse.json({ success: true })));
    const { result } = renderHook(() => useTripJoinRequest(5, { is_viewer: 1, join_request_status: 'pending' }), { wrapper });

    await act(async () => { await result.current.cancelJoin(); });

    await waitFor(() => expect(result.current.joinStatus).toBeNull());
  });

  it('FE-HOOK-TJR-005: a refusal keeps the status and shows the server\'s reason', async () => {
    server.use(http.post('/api/trips/5/join-request', () => HttpResponse.json({ error: 'You are already a member of this trip' }, { status: 400 })));
    const { result } = renderHook(() => useTripJoinRequest(5, { is_viewer: 1, join_request_status: null }), { wrapper });

    await act(async () => { await result.current.requestJoin(); });

    expect(result.current.joinStatus).toBeNull();
    expect(toasts.at(-1)).toEqual(['You are already a member of this trip', 'error']);
  });

  it('FE-HOOK-TJR-006: a second tap while one is in flight is ignored', async () => {
    let asked = 0;
    server.use(http.post('/api/trips/5/join-request', async () => { asked += 1; await new Promise(r => setTimeout(r, 30)); return HttpResponse.json({ status: 'pending' }); }));
    const { result } = renderHook(() => useTripJoinRequest(5, { is_viewer: 1, join_request_status: null }), { wrapper });

    await act(async () => { await Promise.all([result.current.requestJoin(), result.current.requestJoin()]); });

    expect(asked).toBe(1);
  });
});
