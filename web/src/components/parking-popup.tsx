import { Car, ExternalLink, MapPin, X } from "lucide-react";
import type { Map as MaplibreMap } from "maplibre-gl";
import { openPopup } from "#/components/map-popup";
import { Button } from "#/components/ui/button";
import {
	formatArea,
	formatDistance,
	type Lot,
	PARKING_LIMITS,
} from "#/lib/parking";

type LngLat = { lng: number; lat: number };

// Opens the popup for a parking lot, with the flat ground around it at the
// chosen slope limit.
export function showParkingPopup(
	map: MaplibreMap,
	at: LngLat,
	lot: Lot,
	maxSlope: number,
) {
	openPopup(map, at, (close) => (
		<ParkingPopup lot={lot} at={at} maxSlope={maxSlope} onClose={close} />
	));
}

function ParkingPopup({
	lot,
	at,
	maxSlope,
	onClose,
}: {
	lot: Lot;
	at: LngLat;
	maxSlope: number;
	onClose: () => void;
}) {
	const details = [
		lot.hiking && "For hikers",
		lot.fee === "yes" && "Fee",
		lot.fee === "no" && "Free",
	].filter(Boolean);
	const links = [
		{
			label: "Drive there (Google Maps)",
			url: `https://www.google.com/maps/dir/?api=1&destination=${at.lat},${at.lng}`,
			icon: Car,
		},
		// Anyone can fix a lot that's wrong or missing in OpenStreetMap; the
		// next pipeline run picks it up.
		{
			label: "See it in OpenStreetMap",
			url: `https://www.openstreetmap.org/${lot.osm_id}`,
			icon: MapPin,
		},
	];

	return (
		<div className="flex w-64 flex-col gap-3">
			<div className="flex items-start gap-2">
				<div className="flex-1">
					<div className="font-semibold">{lot.name ?? "Parking"}</div>
					<div className="text-muted-foreground text-xs">
						{details.length ? details.join(" · ") : "Parking lot"}, from
						OpenStreetMap: check access before you go
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

			<div className="flex flex-col gap-1 text-xs">
				<div className="text-muted-foreground">
					Flat ground for the tent (up to {maxSlope}°), as the crow flies
				</div>
				{PARKING_LIMITS.map((m) => (
					<div key={m} className="flex justify-between tabular-nums">
						<span>within {formatDistance(m)}</span>
						<span className="font-medium">
							{formatArea(lot[`m${maxSlope}_${m}`] ?? 0)}
						</span>
					</div>
				))}
			</div>

			<div className="flex flex-col gap-1.5">
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
