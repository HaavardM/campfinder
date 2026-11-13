import {
	Check,
	Copy,
	ExternalLink,
	ImageIcon,
	Satellite,
	X,
} from "lucide-react";
import { type LngLat, type Map as MaplibreMap, Popup } from "maplibre-gl";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "#/components/ui/button";
import { googleSatelliteUrl, norgeIBilderUrl } from "#/lib/photo-links";

// A flat area as the map files describe it (pipeline's mapfiles.rs): its
// size, the slope limit it was found at, and a point inside it in UTM 33
// metres.
export type Area = { m2: number; limit: number; x: number; y: number };

// Opens the popup for a flat area at `at`. A click elsewhere on the map
// closes it. MapLibre owns the popup's box, React draws what's inside.
export function showSpotPopup(map: MaplibreMap, at: LngLat, area: Area) {
	const container = document.createElement("div");
	const root = createRoot(container);
	const popup = new Popup({
		className: "spot-popup",
		closeButton: false,
		maxWidth: "none",
		offset: 8,
	})
		.setLngLat(at)
		.setDOMContent(container)
		.addTo(map);
	// Not straight away: the close can come from a click React is handling.
	popup.on("close", () => queueMicrotask(() => root.unmount()));
	root.render(<SpotPopup area={area} at={at} onClose={() => popup.remove()} />);
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
