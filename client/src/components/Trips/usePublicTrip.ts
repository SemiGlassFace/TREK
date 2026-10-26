import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import { tripPublicRepo } from '../../repo/tripPublicRepo';
import { getApiErrorMessage } from '../../types';
import { refusedOffline } from '../../utils/needsConnection';
import { useToast } from '../shared/Toast';

// The state behind the public-trip parts of a trip's Settings, shared by the desktop
// dialog and the phone sheet: the owner's publish switch and the join requests that
// follow it. Markup is each shell's own.

/** The owner's switch that makes a trip readable, read-only, by every signed-in user. */
export function usePublicTrip(tripId: number) {
  const [isPublic, setIsPublic] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    tripPublicRepo
      .getVisibility(tripId)
      .then((d) => setIsPublic(!!d.is_public))
      .catch(() => setIsPublic(null));
  }, [tripId]);

  const toggle = async () => {
    if (isPublic === null || refusedOffline(toast, t)) return;
    setBusy(true);
    try {
      await tripPublicRepo.setVisibility(tripId, !isPublic);
      setIsPublic(!isPublic);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, t('common.error')));
    } finally {
      setBusy(false);
    }
  };

  return { isPublic, busy, toggle };
}

export interface JoinRequest {
  id: number;
  user_id: number;
  username: string;
}

/** Pending requests to join a public trip, and the owner's answer to each. */
export function useJoinRequests(tripId: number, enabled: boolean, onAccepted: () => void) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (!enabled) return;
    tripPublicRepo
      .listJoinRequests(tripId)
      .then(setRequests)
      .catch(() => setRequests([]));
  }, [tripId, enabled]);

  const decide = async (req: JoinRequest, accept: boolean) => {
    if (refusedOffline(toast, t)) return;
    setBusyId(req.id);
    try {
      await (accept
        ? tripPublicRepo.acceptJoinRequest(tripId, req.id)
        : tripPublicRepo.rejectJoinRequest(tripId, req.id));
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      if (accept) onAccepted();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, t('common.error')));
    } finally {
      setBusyId(null);
    }
  };

  return { requests, busyId, decide };
}
