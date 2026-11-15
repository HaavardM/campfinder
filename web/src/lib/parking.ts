// Parking lots as the map files describe them (pipeline's mapfiles.rs, from
// OpenStreetMap), and the distances to parking the files have numbers for.

// The distances to parking the files have counts for (PARKING_LIMITS in
// mapfiles.rs), in metres. Farther than the last counts as no parking near.
export const PARKING_LIMITS = [250, 500, 1000] as const;
export type ParkingLimit = (typeof PARKING_LIMITS)[number];
export function isParkingLimit(value: unknown): value is ParkingLimit {
	return PARKING_LIMITS.includes(value as ParkingLimit);
}
export const MAX_PARKING_M = PARKING_LIMITS[PARKING_LIMITS.length - 1];

// With no distance chosen, lots are ranked by the flat ground within this.
export const RANK_DISTANCE: ParkingLimit = 1000;

// A parking lot: `hiking` when tagged as a lot for hikers, `fee` as OSM's
// "yes" or "no" when known, and the flat ground for the tent around it:
// m3_500 is the m² of spots at up to 3° within 500 m, missing when none.
export type Lot = {
	osm_id: string; // "node/123", "way/456" or "relation/789"
	hiking: boolean;
	name?: string;
	fee?: string;
	[flatAround: `m${number}_${number}`]: number | undefined;
};

// "250 m", "1 km", "1.4 km".
export function formatDistance(m: number) {
	return m < 1000
		? `${Math.round(m / 10) * 10} m`
		: `${Number((m / 1000).toFixed(1))} km`;
}

// "800 m²", "3.4 ha" (a hectare is 100 × 100 m).
export function formatArea(m2: number) {
	return m2 < 10_000
		? `${Math.round(m2 / 100) * 100} m²`
		: `${(m2 / 10_000).toFixed(1)} ha`;
}
