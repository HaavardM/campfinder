import { Tent } from "lucide-react";

import { PlaceSearch } from "#/components/place-search";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { BASEMAPS, type Basemap, isBasemap } from "#/lib/basemaps";
import type { Place } from "#/lib/place-search";
import { REGIONS, type Region } from "#/lib/regions";

type Props = {
	basemap: Basemap;
	onBasemapChange: (basemap: Basemap) => void;
	onPlaceSelect: (place: Place) => void;
	onRegionSelect: (region: Region) => void;
};

// The floating panel in the top-left corner of the map.
export function MapPanel({
	basemap,
	onBasemapChange,
	onPlaceSelect,
	onRegionSelect,
}: Props) {
	return (
		<Card className="absolute top-3 left-3 z-10 w-[min(20rem,calc(100vw-5rem))] gap-0 py-0 shadow-lg">
			<CardContent className="flex flex-col gap-3 p-3">
				<div className="flex items-center gap-2 font-semibold">
					<Tent className="size-5" />
					Campfinder
				</div>

				<PlaceSearch onSelect={onPlaceSelect} />

				<div className="flex items-center justify-between gap-2">
					<div className="flex gap-1">
						{REGIONS.map((region) => (
							<Button
								key={region.name}
								variant="secondary"
								size="sm"
								onClick={() => onRegionSelect(region)}
							>
								{region.name}
							</Button>
						))}
					</div>

					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={basemap}
						// Radix sends "" when the active item is clicked again; ignore it
						// so one basemap is always selected.
						onValueChange={(value) => {
							if (isBasemap(value)) onBasemapChange(value);
						}}
					>
						{Object.entries(BASEMAPS).map(([name, { label }]) => (
							<ToggleGroupItem key={name} value={name} className="px-2.5">
								{label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
			</CardContent>
		</Card>
	);
}
