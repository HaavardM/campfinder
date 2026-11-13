import { Check, Copy, ExternalLink, type LucideIcon, X } from "lucide-react";
import { type LngLat, type Map as MaplibreMap, Popup } from "maplibre-gl";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "#/components/ui/button";

export type SpotLink = { label: string; url: string; icon: LucideIcon };

type Props = {
	m2: number;
	maxSlope: number;
	lat: number;
	lon: number;
	links: SpotLink[];
	onClose: () => void;
};

// Opens the popup for a flat area at `at`. A click elsewhere on the map
// closes it. MapLibre owns the popup's box, React draws what's inside.
export function showSpotPopup(
	map: MaplibreMap,
	at: LngLat,
	props: Omit<Props, "onClose">,
) {
	const container = document.createElement("div");
	const root = createRoot(container);
	const popup = new Popup({ closeButton: false, maxWidth: "none", offset: 8 })
		.setLngLat(at)
		.setDOMContent(container)
		.addTo(map);
	// Not straight away: the close can come from a click React is handling.
	popup.on("close", () => queueMicrotask(() => root.unmount()));
	root.render(<SpotPopup {...props} onClose={() => popup.remove()} />);
}

function SpotPopup({ m2, maxSlope, lat, lon, links, onClose }: Props) {
	const [copied, setCopied] = useState(false);
	// Latitude, longitude: what GPS units, Google and inReach take.
	const coordinates = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
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
						{m2.toLocaleString()} m² of flat ground
					</div>
					<div className="text-muted-foreground text-xs">
						Slopes up to {maxSlope}° under the tent
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
