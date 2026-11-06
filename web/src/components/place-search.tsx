import { LoaderCircle, MapPin, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "#/components/ui/input";
import { type Place, searchPlaces } from "#/lib/place-search";

type Props = { onSelect: (place: Place) => void };

export function PlaceSearch({ onSelect }: Props) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Place[]>([]);
	const [loading, setLoading] = useState(false);

	// Search 250 ms after the user stops typing. Each new query aborts the
	// previous request, so a slow old response can't overwrite a newer one.
	useEffect(() => {
		const trimmed = query.trim();
		if (trimmed.length < 2) {
			setResults([]);
			setLoading(false);
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			setLoading(true);
			try {
				setResults(await searchPlaces(trimmed, controller.signal));
			} catch (error) {
				if (!controller.signal.aborted) console.error(error);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		}, 250);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query]);

	function select(place: Place) {
		onSelect(place);
		setQuery("");
		setResults([]);
	}

	return (
		<div className="relative">
			<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && results[0]) select(results[0]);
					if (event.key === "Escape") setQuery("");
				}}
				placeholder="Search places, e.g. Mysuseter"
				className="pl-9"
				aria-label="Search places"
			/>
			{loading && (
				<LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
			)}
			{results.length > 0 && (
				<ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border bg-popover py-1 shadow-md">
					{results.map((place) => (
						<li key={place.id}>
							<button
								type="button"
								onClick={() => select(place)}
								className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
							>
								<MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span>
									<span className="font-medium">{place.name}</span>
									<span className="block text-xs text-muted-foreground">
										{[place.kind, place.municipality]
											.filter(Boolean)
											.join(" · ")}
									</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
