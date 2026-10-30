import type { PlaceContribDecisionRequest, PlaceContribState } from '@trek/shared';
import { useCallback, useEffect, useState } from 'react';
import { placeContribRepo } from '../../repo/placeContribRepo';

/**
 * The admin's decision on sharing place details. Read once when the settings
 * tab opens, so the prompt can come up without the card being scrolled to;
 * every decision answers the new state, which replaces the old one.
 */
export function usePlaceContrib() {
  const [state, setState] = useState<PlaceContribState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    placeContribRepo.state(controller.signal).then(setState, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);

  const decide = useCallback(async (body: PlaceContribDecisionRequest): Promise<PlaceContribState> => {
    setBusy(true);
    try {
      const next = await placeContribRepo.decide(body);
      setState(next);
      return next;
    } finally {
      setBusy(false);
    }
  }, []);

  const withdraw = useCallback(async () => {
    setBusy(true);
    try {
      const result = await placeContribRepo.withdraw();
      setState(await placeContribRepo.state());
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, failed, busy, decide, withdraw };
}
