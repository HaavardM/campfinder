import { Footprints, Mountain, Satellite, Tent, TentTree } from "lucide-react";
import { useState } from "react";
import { FloatingPanel } from "#/components/floating-panel";
import { PlaceSearch } from "#/components/place-search";
import { Button } from "#/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Slider } from "#/components/ui/slider";
import { Toggle } from "#/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { BASEMAPS, type Basemap, isBasemap } from "#/lib/basemaps";
import {
	AREA_COLOUR,
	AREA_OUTLINE_COLOUR,
	PARKING_COLOUR,
	type RankedLot,
	SCORE_COLOURS,
	SLOPE_LIMITS,
	type SlopeLimit,
} from "#/lib/flat-layers";
import type { Tent as TentRow } from "#/lib/map-data";
import {
	formatArea,
	formatDistance,
	PARKING_LIMITS,
	type ParkingLimit,
	RANK_DISTANCE,
} from "#/lib/parking";
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
	parking: ParkingLimit | undefined;
	onParkingChange: (parking: ParkingLimit | undefined) => void;
	bestParking: RankedLot[];
	onLotSelect: (lot: RankedLot) => void;
	photoUrl: string;
	trails: boolean;
	onTrailsChange: (trails: boolean) => void;
	hillshade: boolean;
	onHillshadeChange: (hillshade: boolean) => void;
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
		<FloatingPanel
			title="Campfinder"
			icon={Tent}
			className="w-[min(20rem,calc(100vw-5rem))]"
		>
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
							<ToggleGroupItem key={season} value={season} className="flex-1">
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
								const limit = SLOPE_LIMITS.find((l) => String(l) === value);
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

					{/* Spots this close to parking stand out; the rest are dimmed,
					    since OpenStreetMap doesn't know every lot. */}
					<div className="flex flex-col gap-2 text-sm">
						<span className="text-muted-foreground">
							Close to parking (as the crow flies)
						</span>
						<ToggleGroup
							type="single"
							variant="outline"
							size="sm"
							className="w-full"
							value={String(props.parking ?? "any")}
							onValueChange={(value) => {
								if (!value) return; // the active item clicked again
								props.onParkingChange(
									PARKING_LIMITS.find((l) => String(l) === value),
								);
							}}
						>
							<ToggleGroupItem value="any" className="flex-1">
								Any
							</ToggleGroupItem>
							{PARKING_LIMITS.map((limit) => (
								<ToggleGroupItem
									key={limit}
									value={String(limit)}
									className="flex-1 px-1"
								>
									{formatDistance(limit)}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>

					<ScoreLegend />
				</div>

				<BestParking
					lots={props.bestParking}
					distance={props.parking ?? RANK_DISTANCE}
					onSelect={props.onLotSelect}
				/>

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
					<Button asChild variant="outline" size="sm" className="px-2.5">
						<a
							href="/tent"
							target="_blank"
							rel="noreferrer"
							title="Our tent at true size, in 3D: the Gamme 8 PC"
						>
							<TentTree />
						</a>
					</Button>
					<Toggle
						variant="outline"
						size="sm"
						className="px-2.5"
						pressed={props.trails}
						onPressedChange={props.onTrailsChange}
						title="Marked trails: hiking in summer, ski in winter"
						aria-label="Trails"
					>
						<Footprints />
					</Toggle>
					<Toggle
						variant="outline"
						size="sm"
						className="px-2.5"
						pressed={props.hillshade}
						onPressedChange={props.onHillshadeChange}
						title="Terrain shading from the 1 m height model: hummocks and boulders, close up"
						aria-label="Terrain shading"
					>
						<Mountain />
					</Toggle>
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
		</FloatingPanel>
	);
}

// The parking lots in view with the most flat ground for the tent around
// them: where to drive to. Click one to go there.
function BestParking({
	lots,
	distance,
	onSelect,
}: {
	lots: RankedLot[];
	distance: ParkingLimit;
	onSelect: (lot: RankedLot) => void;
}) {
	return (
		<div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
			<div className="flex justify-between gap-2">
				<span className="font-medium">Best parking in view</span>
				<span className="text-muted-foreground text-xs">
					flat within {formatDistance(distance)}
				</span>
			</div>
			{lots.length === 0 && (
				<span className="text-muted-foreground text-xs">
					No parking with flat ground in reach here. Zoom in on a region.
				</span>
			)}
			{lots.map((ranked) => (
				<Button
					key={ranked.lot.osm_id}
					variant="ghost"
					size="sm"
					className="-mx-2 justify-between gap-2"
					onClick={() => onSelect(ranked)}
				>
					<span className="flex min-w-0 items-center gap-1.5">
						<span
							className="size-2 shrink-0 rounded-full"
							style={{ background: PARKING_COLOUR }}
						/>
						<span className="truncate">{ranked.lot.name ?? "Parking"}</span>
						{ranked.lot.hiking && (
							<span className="text-muted-foreground text-xs">hikers</span>
						)}
					</span>
					<span className="font-medium tabular-nums">
						{formatArea(ranked.m2)}
					</span>
				</Button>
			))}
		</div>
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
				Zoom in to see where it fits, darker where flatter; click an area for
				aerial photos.
			</span>
			<span className="flex items-center gap-1.5">
				<span
					className="size-2.5 shrink-0 rounded-full border border-white"
					style={{ background: PARKING_COLOUR }}
				/>
				Parking from OpenStreetMap: bigger with more flat ground in reach.
			</span>
		</div>
	);
}
