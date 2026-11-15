import {
	Check,
	Copy,
	ExternalLink,
	ImageIcon,
	Satellite,
	X,
} from "lucide-react";
import type { LngLat, Map as MaplibreMap } from "maplibre-gl";
import { useState } from "react";
import { openPopup } from "#/components/map-popup";
import { Button } from "#/components/ui/button";
import { formatDistance, MAX_PARKING_M } from "#/lib/parking";
import { googleSatelliteUrl, norgeIBilderUrl } from "#/lib/photo-links";

// A flat area as the map files describe it (pipeline's mapfiles.rs): its
// size, the slope limit it was found at, a point inside it in UTM 33
// metres, and how far its nearest part is from parking in a straight line
// (missing when no lot is within MAX_PARKING_M).
export type Area = {
	m2: number;
	limit: number;
	x: number;
	y: number;
	parking_m?: number;
};

// Opens the popup for a flat area at `at`.
export function showSpotPopup(map: MaplibreMap, at: LngLat, area: Area) {
	openPopup(map, at, (close) => (
		<SpotPopup area={area} at={at} onClose={close} />
	));
}

function SpotPopup({
	area,
	at,
	onClose,
}: {
	area: Area;
	at: LngLat;
	onClose: () => void;
}) {
	const [copied, setCopied] = useState(false);
	// Photos of the ground: Norge i bilder's are the sharpest; Google's are
	// often from another year or season.
	const links = [
		{
			label: "Norge i bilder 3D",
			url: norgeIBilderUrl(area.x, area.y, area.m2),
			icon: ImageIcon,
		},
		{
			label: "Google satellite",
			url: googleSatelliteUrl(at.lat, at.lng, 19),
			icon: Satellite,
		},
	];
	// Latitude, longitude: what GPS units, Google and inReach take.
	const coordinates = `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}`;
	const copy = () =>
		// Fails without HTTPS (e.g. the dev server opened from a phone);
		// the coordinates are on the button to read off anyway.
		navigator.clipboard.writeText(coordinates).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			},
			() => {},
		);

	return (
		<div className="flex w-64 flex-col gap-3">
			<div className="flex items-start gap-2">
				<div className="flex-1">
					<div className="font-semibold">
						{area.m2.toLocaleString()} m² of flat ground
					</div>
					<div className="text-muted-foreground text-xs">
						Slopes up to {area.limit}° under the tent
					</div>
					<div className="text-muted-foreground text-xs">
						{area.parking_m === undefined
							? `No parking known within ${formatDistance(MAX_PARKING_M)}`
							: `Parking ${formatDistance(area.parking_m)} away, as the crow flies`}
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					className="-mt-1 -mr-1"
					aria-label="Close"
					onClick={onClose}
				>
					<X />
				</Button>
			</div>

			<Button
				variant="outline"
				size="sm"
				className="justify-between font-mono tabular-nums"
				title="Copy coordinates"
				onClick={copy}
			>
				{coordinates}
				{copied ? <Check /> : <Copy />}
			</Button>

			<div className="flex flex-col gap-1.5">
				<div className="text-muted-foreground text-xs">
					Check the ground in photos
				</div>
				{links.map(({ label, url, icon: Icon }) => (
					<Button
						key={label}
						asChild
						variant="secondary"
						className="justify-start"
					>
						<a href={url} target="_blank" rel="noreferrer">
							<Icon />
							{label}
							<ExternalLink className="ml-auto text-muted-foreground" />
						</a>
					</Button>
				))}
			</div>
		</div>
	);
}
