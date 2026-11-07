// Results are computed for both: in winter, snow covers the bogs.
export const SEASONS = { summer: "Summer", winter: "Winter" } as const;
export type Season = keyof typeof SEASONS;
export function isSeason(value: unknown): value is Season {
	return typeof value === "string" && value in SEASONS;
}
