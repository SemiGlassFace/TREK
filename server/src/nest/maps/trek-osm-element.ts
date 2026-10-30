import { getJson, type TrekCommunityValues } from './trek-places.client';

/** An OSM element as the TREK Places API's details layer answers it: the tags, the point, and the community values. */
interface TrekOsmElement extends TrekCommunityValues {
  name: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

/** The details layer answers in well under a second or not at all; Overpass is the fallback, not this. */
const TIMEOUT_MS = 3_000;

/**
 * An element's detail tags from TREK's own copy of OpenStreetMap
 * (`/v1/osm/{type}/{id}`), or null when the layer does not hold it, the index
 * is switched off or the service does not answer. Then Overpass is asked, as
 * before.
 */
export async function trekOsmElement(osmType: string, osmId: string): Promise<TrekOsmElement | null> {
  try {
    const body = await getJson<{ place?: TrekOsmElement }>(
      `/v1/osm/${encodeURIComponent(osmType)}/${encodeURIComponent(osmId)}`,
      {},
      { timeoutMs: TIMEOUT_MS },
    );
    const place = body.place;
    return place && typeof place.lat === 'number' && typeof place.lng === 'number' && place.tags ? place : null;
  } catch {
    return null;
  }
}

/** The element as Overpass would have placed it (the shape of OverpassElement), for the code that reads Overpass answers. */
export function asOverpassElement(element: TrekOsmElement): { tags: Record<string, string>; lat: number; lon: number } {
  return { tags: element.tags, lat: element.lat, lon: element.lng };
}
