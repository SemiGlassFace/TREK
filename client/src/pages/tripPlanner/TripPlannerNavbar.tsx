import { UserPlus, X } from 'lucide-react';
import Navbar from '../../components/Layout/Navbar';
import { useTranslation } from '../../i18n';
import type { useTripJoinRequest } from './useTripJoinRequest';

interface TripPlannerNavbarProps {
  trip: { title: string };
  tripId: number;
  tripJoin: ReturnType<typeof useTripJoinRequest>;
  onBack: () => void;
  /** A member's Settings button. */
  onSettings: () => void;
}

/**
 * The planner's header. A visitor of a public trip has no members to manage: the one
 * action is to ask the owner to add them, or to withdraw that request while it is pending.
 */
export function TripPlannerNavbar({ trip, tripId, tripJoin, onBack, onSettings }: TripPlannerNavbarProps) {
  const { t } = useTranslation();
  if (!tripJoin.readOnly)
    return <Navbar tripTitle={trip.title} tripId={tripId} showBack onBack={onBack} onSettings={onSettings} />;
  const pending = tripJoin.joinStatus === 'pending';
  return (
    <Navbar
      tripTitle={trip.title}
      tripId={tripId}
      showBack
      onBack={onBack}
      onSettings={tripJoin.joinBusy ? undefined : () => void (pending ? tripJoin.cancelJoin() : tripJoin.requestJoin())}
      settingsLabel={pending ? t('trips.joinRequests.pending') : t('trips.joinRequests.request')}
      settingsIcon={
        pending ? (
          <X className="h-4 w-4 flex-none text-content-muted" aria-hidden="true" />
        ) : (
          <UserPlus className="h-4 w-4 flex-none text-content-muted" aria-hidden="true" />
        )
      }
    />
  );
}
