import { Tent } from "lucide-react";
import { useEffect, useState } from "react";

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
import { SHARE_COLOURS } from "#/lib/flat-layers";
import type { Place } from "#/lib/place-search";
import { REGIONS, type Region } from "#/lib/regions";
import type { Tent as TentRow } from "#/server/tents";

type Props = {
	tents: TentRow[];
	tent: string | undefined;
	onTentChange: (tent: string) => void;
	maxSlope: number;
	onMaxSlopeChange: (maxSlope: number) => void;
	basemap: Basemap;
	onBasemapChange: (basemap: Basemap) => void;
	onPlaceSelect: (place: Place) => void;
	onRegionSelect: (region: Region) => void;
};

// The floating panel in the top-left corner of the map.
export function MapPanel(props: Props) {
	// The slider shows its value while dragging, but only updates the map
	// (and refetches tiles) when released.
	const [slope, setSlope] = useState(props.maxSlope);
	useEffect(() => setSlope(props.maxSlope), [props.maxSlope]);

	return (
		<Card className="absolute top-3 left-3 z-10 w-[min(20rem,calc(100vw-5rem))] gap-0 py-0 shadow-lg">
			<CardContent className="flex flex-col gap-3 p-3">
				<div className="flex items-center gap-2 font-semibold">
					<Tent className="size-5" />
					Campfinder
				</div>

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

					<div className="flex flex-col gap-2">
						<div className="flex justify-between text-sm">
							<span className="text-muted-foreground">Max slope</span>
							<span className="font-medium tabular-nums">{slope}°</span>
						</div>
						<Slider
							min={1}
							max={10}
							step={0.5}
							value={[slope]}
							onValueChange={([value]) => setSlope(value)}
							onValueCommit={([value]) => props.onMaxSlopeChange(value)}
							aria-label="Max slope"
						/>
					</div>

					<ShareLegend />
				</div>

				<div className="flex items-center justify-between gap-2">
					<div className="flex gap-1">
						{REGIONS.map((region) => (
							<Button
								key={region.name}
								variant="secondary"
								size="sm"
								onClick={() => props.onRegionSelect(region)}
							>
								{region.name}
							</Button>
						))}
					</div>

					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={props.basemap}
						// Radix sends "" when the active item is clicked again; ignore it
						// so one basemap is always selected.
						onValueChange={(value) => {
							if (isBasemap(value)) props.onBasemapChange(value);
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

// What the colours mean when zoomed out: the share of the ground in each
// square where the tent fits within the max slope.
function ShareLegend() {
	const first = SHARE_COLOURS[0][0];
	const last = SHARE_COLOURS[SHARE_COLOURS.length - 1][0];
	const stops = SHARE_COLOURS.map(
		([share, colour]) =>
			`${colour} ${((share - first) / (last - first)) * 100}%`,
	);
	return (
		<div className="flex flex-col gap-1 text-xs text-muted-foreground">
			<span>Ground where the tent fits</span>
			<div
				className="h-2 rounded-full"
				style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }}
			/>
			<div className="flex justify-between tabular-nums">
				<span>{first * 100}%</span>
				<span>{last * 100}%+</span>
			</div>
		</div>
	);
}
