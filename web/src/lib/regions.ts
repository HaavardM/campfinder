export type Region = {
	name: string;
	// [west, south, east, north] in longitude/latitude
	bounds: [number, number, number, number];
};

// Areas the pipeline has processed. Used only to move the map, so rough
// bounds are fine.
export const REGIONS: Region[] = [
	{ name: "Rondane", bounds: [9.45, 61.72, 10.3, 62.12] },
	{ name: "Dovre", bounds: [8.9, 62.0, 9.9, 62.45] },
	{ name: "Sogn", bounds: [5.7, 61.0, 7.4, 61.6] },
];
