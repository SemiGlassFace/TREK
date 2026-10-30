import { trekCommunityByKeys, type TrekCommunityValues } from './trek-places.client';
import { normalizePlaceWebsite } from '@trek/shared';

/**
 * Community values for places TREK did not find in its own index: a relation
 * Photon returned, a way from Overpass. The index rows carry them already
 * (the service lays them over its own answers); these places get them from
 * /v1/community, so a value one installation sent shows on the next open of
 * the same place everywhere.
 */

/** The service's key of an OSM details id: `relation:3389505` is `osm:relation/3389505`. */
export function communityKeyOf(placeId: string): string | null {
  const match = /^(node|way|relation):(\d+)$/.exec(placeId);
  return match ? `osm:${match[1]}/${match[2]}` : null;
}

/** The details record with what the community published laid over it; untouched where nothing was. */
export function withCommunityValues(
  details: Record<string, unknown>,
  values: TrekCommunityValues | undefined,
): Record<string, unknown> {
  if (!values?.community) return details;
  const out: Record<string, unknown> = { ...details };
  const website = normalizePlaceWebsite(values.contact?.website);
  if (website) out.website = website;
  if (values.contact?.phone) out.phone = values.contact.phone;
  if (values.contact?.email) out.email = values.contact.email;
  if (values.hours?.osm) out.opening_hours = values.hours.osm;
  if (values.description?.text) out.description = values.description.text;
  if (typeof values.community.version === 'number') out.community_version = values.community.version;
  return out;
}

/** OSM details as Overpass and Photon gave them, with the community's values for the same element. */
export async function osmDetailsWithCommunity(
  placeId: string,
  details: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  const key = communityKeyOf(placeId);
  if (!details || !key) return details;
  const published = await trekCommunityByKeys([key]);
  return withCommunityValues(details, published[key]);
}
