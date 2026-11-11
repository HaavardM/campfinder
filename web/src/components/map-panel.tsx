import { ChevronDown, Satellite, Tent } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useState } from "react";

import { PlaceSearch } from "#/components/place-search";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Slider } from "#/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { BASEMAPS, type Basemap, isBasemap } from "#/lib/basemaps";
import {
	AREA_COLOUR,
	AREA_OUTLINE_COLOUR,
	SCORE_COLOURS,
	SLOPE_LIMITS,
	type SlopeLimit,
} from "#/lib/flat-layers";
import type { Tent as TentRow } from "#/lib/map-data";
import type { Place } from "#/lib/place-search";
import { REGIONS, type Region } from "#/lib/regions";
import { isSeason, SEASONS, type Season } from "#/lib/seasons";

type Props = {
	tents: TentRow[];
	tent: string | undefined;
	onTentChange: (tent: string) => void;
	season: Season;
	onSeasonChange: (season: Season) => void;
	maxSlope: SlopeLimit;
	onMaxSlopeChange: (maxSlope: SlopeLimit) => void;
	minArea: number;
	onMinAreaChange: (minArea: number) => void;
	photoUrl: string;
	basemap: Basemap;
	onBasemapChange: (basemap: Basemap) => void;
	onPlaceSelect: (place: Place) => void;
	onRegionSelect: (region: Region) => void;
};

// The floating panel in the top-left corner of the map.
export function MapPanel(props: Props) {
	// The slider shows its value while dragging, but only updates the map
	// when released.
	const [area, setArea] = useState(props.minArea);

	return (
		<Card className="absolute top-3 left-3 z-10 w-[min(20rem,calc(100vw-5rem))] gap-0 py-0 shadow-lg">
			{/* Tapping the title folds the panel down to it, so the map can be
			    seen on a small screen. */}
			<Collapsible.Root asChild defaultOpen>
				<CardContent className="flex flex-col p-3">
					<Collapsible.Trigger
						className="group flex items-center gap-2 font-semibold"
						title="Show or hide the menu"
					>
						<Tent className="size-5" />
						Campfinder
						<ChevronDown className="ml-auto size-5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
					</Collapsible.Trigger>

					<Collapsible.Content className="-mx-1 overflow-hidden px-1 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
						<div className="flex flex-col gap-3 pt-3 pb-1">
							<PlaceSearch onSelect={props.onPlaceSelect} />

							<div className="flex flex-col gap-3 rounded-md border p-3">
								<Select value={props.tent} onValueChange={props.onTentChange}>
									<SelectTrigger className="w-full" aria-label="Tent">
										<SelectValue placeholder="No tents computed yet" />
									</SelectTrigger>
									<SelectContent>
										{props.tents.map((tent) => (
											<SelectItem key={tent.slug} value={tent.slug}>
												{tent.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								{/* Winter: snow covers the bogs and natural lakes are frozen. */}
								<ToggleGroup
									type="single"
									variant="outline"
									size="sm"
									className="w-full"
									value={props.season}
									onValueChange={(value) => {
										if (isSeason(value)) props.onSeasonChange(value);
									}}
								>
									{Object.entries(SEASONS).map(([season, label]) => (
										<ToggleGroupItem
											key={season}
											value={season}
											className="flex-1"
										>
											{label}
										</ToggleGroupItem>
									))}
								</ToggleGroup>

								{/* The slope limits the map files have areas for. */}
								<div className="flex items-center justify-between gap-2 text-sm">
									<span className="text-muted-foreground">Max slope</span>
									<ToggleGroup
										type="single"
										variant="outline"
										size="sm"
										value={String(props.maxSlope)}
										onValueChange={(value) => {
											const limit = SLOPE_LIMITS.find(
												(l) => String(l) === value,
											);
											if (limit) props.onMaxSlopeChange(limit);
										}}
									>
										{SLOPE_LIMITS.map((limit) => (
											<ToggleGroupItem
												key={limit}
												value={String(limit)}
												className="px-3"
											>
												{limit}°
											</ToggleGroupItem>
										))}
									</ToggleGroup>
								</div>

								<div className="flex flex-col gap-2">
									<div className="flex justify-between text-sm">
										<span className="text-muted-foreground">Min area</span>
										<span className="font-medium tabular-nums">{area} m²</span>
									</div>
									<Slider
										min={100}
										max={2000}
										step={100}
										value={[area]}
										onValueChange={([value]) => setArea(value)}
										onValueCommit={([value]) => props.onMinAreaChange(value)}
										aria-label="Min area"
									/>
								</div>

								<ScoreLegend />
							</div>

							<div className="flex gap-1">
								{REGIONS.map((region) => (
									<Button
										key={region.name}
										variant="secondary"
										size="sm"
										className="flex-1"
										onClick={() => props.onRegionSelect(region)}
									>
										{region.name}
									</Button>
								))}
							</div>

							<div className="flex gap-1">
								<Button asChild variant="outline" size="sm" className="px-2.5">
									<a
										href={props.photoUrl}
										target="_blank"
										rel="noreferrer"
										title="Satellite photo of this view (Google Maps)"
									>
										<Satellite />
									</a>
								</Button>
								<ToggleGroup
									type="single"
									variant="outline"
									size="sm"
									className="flex-1"
									value={props.basemap}
									// Radix sends "" when the active item is clicked again; ignore it
									// so one basemap is always selected.
									onValueChange={(value) => {
										if (isBasemap(value)) props.onBasemapChange(value);
									}}
								>
									{Object.entries(BASEMAPS).map(([name, { label }]) => (
										<ToggleGroupItem key={name} value={name} className="flex-1">
											{label}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</div>
						</div>
					</Collapsible.Content>
				</CardContent>
			</Collapsible.Root>
		</Card>
	);
}

// What the colours mean: green areas have spots for the tent, and the orange
// areas, when zoomed in, are where it fits.
function ScoreLegend() {
	const first = SCORE_COLOURS[0][0];
	const last = SCORE_COLOURS[SCORE_COLOURS.length - 1][0];
	const stops = SCORE_COLOURS.map(
		([score, colour]) =>
			`${colour} ${((score - first) / (last - first)) * 100}%`,
	);
	return (
		<div className="flex flex-col gap-1 text-xs text-muted-foreground">
			<span>Spots for the tent</span>
			<div
				className="h-2 rounded-full"
				style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }}
			/>
			<div className="flex justify-between">
				<span>A few</span>
				<span>Many</span>
			</div>
			<span className="flex items-center gap-1.5">
				<span
					className="size-2.5 shrink-0 border"
					style={{ background: AREA_COLOUR, borderColor: AREA_OUTLINE_COLOUR }}
				/>
				Zoom in to see where it fits; click an area for aerial photos.
			</span>
		</div>
	);
}
