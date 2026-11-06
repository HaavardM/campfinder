// Place-name search using Kartverket's official place-name register
// (Sentralt stedsnavnregister). Free, no key, and it allows browser requests.
// Docs: https://ws.geonorge.no/stedsnavn/v1/

export type Place = {
	id: number;
	name: string;
	kind: string; // e.g. "Fjell", "Vann", "Turisthytte"
	municipality: string;
	lon: number;
	lat: number;
};

type NavnResponse = {
	navn: {
		stedsnummer: number;
		skrivemåte: string;
		navneobjekttype: string;
		kommuner?: { kommunenavn: string }[];
		representasjonspunkt: { nord: number; øst: number };
	}[];
};

export async function searchPlaces(
	query: string,
	signal: AbortSignal,
): Promise<Place[]> {
	const params = new URLSearchParams({
		sok: `${query}*`, // trailing * makes it a prefix search
		treffPerSide: "8",
		utkoordsys: "4326", // return longitude/latitude
	});
	const response = await fetch(
		`https://ws.geonorge.no/stedsnavn/v1/navn?${params}`,
		{ signal },
	);
	if (!response.ok) {
		throw new Error(`Place search failed: ${response.status}`);
	}
	const body: NavnResponse = await response.json();

	// The same place can appear under several spellings; keep the first.
	const seen = new Set<number>();
	const places: Place[] = [];
	for (const hit of body.navn) {
		if (seen.has(hit.stedsnummer)) continue;
		seen.add(hit.stedsnummer);
		places.push({
			id: hit.stedsnummer,
			name: hit.skrivemåte,
			kind: hit.navneobjekttype,
			municipality: hit.kommuner?.[0]?.kommunenavn ?? "",
			lon: hit.representasjonspunkt.øst,
			lat: hit.representasjonspunkt.nord,
		});
	}
	return places;
}
