import { Check, Eye, EyeOff, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { DialogButton, DialogSection, fs } from '../shared/DialogShell';
import { PANEL } from '../shared/dialogParts';
import { TripMemberAvatar } from './TripMemberAvatar';
import { useJoinRequests, usePublicTrip } from './usePublicTrip';

/** The owner's switch for making the trip readable, read-only, by every signed-in user. */
export function PublicTripCard({ tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const pub = usePublicTrip(tripId);
  if (pub.isPublic === null) return null;
  return (
    <section className={PANEL}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-surface-card text-content-muted shadow-sm">
          {pub.isPublic ? <Eye size={15} strokeWidth={2.2} /> : <EyeOff size={15} strokeWidth={2.2} />}
        </span>
        <div className="min-w-0">
          <h3 className="m-0 font-semibold text-content" style={fs(13, 'body')}>
            {t('trips.public.title')}
          </h3>
          <p className="m-0 mt-0.5 leading-normal text-content-faint" style={fs(11.5)}>
            {pub.isPublic ? t('trips.public.enabled') : t('trips.public.disabled')}
          </p>
        </div>
      </div>
      <div>
        <DialogButton
          onClick={() => void pub.toggle()}
          disabled={pub.busy}
          icon={pub.isPublic ? <EyeOff size={14} strokeWidth={2.2} /> : <Eye size={14} strokeWidth={2.2} />}
        >
          {pub.isPublic ? t('trips.public.makePrivate') : t('trips.public.makePublic')}
        </DialogButton>
      </div>
    </section>
  );
}

/** People asking to join a public trip; nothing while there are none. */
export function JoinRequestsList({ tripId, onAccepted }: { tripId: number; onAccepted: () => void }) {
  const { t } = useTranslation();
  const { requests, busyId, decide } = useJoinRequests(tripId, true, onAccepted);
  if (requests.length === 0) return null;
  return (
    <DialogSection label={`${t('trips.joinRequests.title')} (${requests.length})`}>
      <div className="flex flex-col gap-0.5 rounded-[14px] border border-edge-faint bg-surface-secondary p-1.5">
        {requests.map((req) => (
          <div
            key={req.id}
            className="flex min-h-[48px] items-center gap-3 rounded-[10px] px-2.5 py-1.5 hover:bg-surface-card"
          >
            <TripMemberAvatar username={req.username} avatarUrl={null} />
            <span className="min-w-0 flex-1 truncate font-semibold text-content" style={fs(13, 'body')}>
              {req.username}
            </span>
            <DialogButton
              variant="primary"
              onClick={() => void decide(req, true)}
              disabled={busyId !== null}
              icon={<Check size={13} strokeWidth={2.4} />}
            >
              {t('trips.joinRequests.accept')}
            </DialogButton>
            <DialogButton
              onClick={() => void decide(req, false)}
              disabled={busyId !== null}
              icon={<X size={13} strokeWidth={2.4} />}
            >
              {t('trips.joinRequests.reject')}
            </DialogButton>
          </div>
        ))}
      </div>
    </DialogSection>
  );
}
