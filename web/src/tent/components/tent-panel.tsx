import {
	Armchair,
	Bed,
	Footprints,
	LayoutGrid,
	Leaf,
	Map as MapIcon,
	Maximize,
	Minimize,
	Moon,
	Mountain,
	RotateCcw,
	Snowflake,
	Sun,
	Sunset,
	Tent,
} from "lucide-react";
import { useEffect, useState } from "react";

import { FloatingPanel } from "#/components/floating-panel";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { SEASONS, type Season } from "#/lib/seasons";
import type { TimeOfDay } from "#/tent/lighting";
import { controls, type Info, listeners, type View } from "#/tent/scene";
import { COT, cm, PEOPLE } from "#/tent/specs";
import { HEADROOM } from "#/tent/tent";

const VIEWS: [View, string, typeof Mountain][] = [
	["outside", "Outside", Mountain],
	["walk", "Walk", Footprints],
	["sit", "Sit", Armchair],
	["lie", "Lie", Bed],
	["plan", "Plan", LayoutGrid],
];

// Winter first: the stove is what this tent is for.
const SEASON_ICONS: [Season, typeof Sun][] = [
	["winter", Snowflake],
	["summer", Leaf],
];

const TIMES: [TimeOfDay, string, typeof Sun][] = [
	["day", "Day", Sun],
	["evening", "Evening", Sunset],
	["night", "Night", Moon],
];

type Who = keyof typeof PEOPLE;

// The floating panel in the top-left corner, as on the map.
export function TentPanel() {
	const [view, setView] = useState<View>("sit");
	const [time, setTime] = useState<TimeOfDay>("day");
	const [season, setSeason] = useState<Season>("winter");
	const [who, setWho] = useState<Who>("you");
	const [frontDoor, setFrontDoor] = useState(true);
	const [backDoor, setBackDoor] = useState(false);
	const [seeThrough, setSeeThrough] = useState(false);
	const [headroom, setHeadroom] = useState(true);
	const [dryingLine, setDryingLine] = useState(false);
	const [legKit, setLegKit] = useState(false);
	const [highQuality, setHighQuality] = useState(false);
	const fullscreen = useFullscreen();
	// Folded down while you look around with the mouse; open again when Esc
	// frees the mouse to use it.
	const [panelOpen, setPanelOpen] = useState(true);
	useEffect(() => {
		const update = () => setPanelOpen(document.pointerLockElement === null);
		document.addEventListener("pointerlockchange", update);
		return () => document.removeEventListener("pointerlockchange", update);
	}, []);
	// Walking, sitting and lying are all seen through your own eyes.
	const firstPerson = view === "walk" || view === "sit" || view === "lie";
	const [info, setInfo] = useState<Info | null>(null);

	useEffect(() => {
		listeners.info = setInfo;
		controls.refresh();
	}, []);
	useEffect(() => controls.setView(view), [view]);
	useEffect(() => controls.setTime(time), [time]);
	useEffect(() => controls.setSeason(season), [season]);
	useDarkAtNight(time);
	useEffect(() => controls.setWalkAs(who), [who]);
	useEffect(
		() => controls.setDoors(frontDoor, backDoor),
		[frontDoor, backDoor],
	);
	// The floor plan always looks through the fabric.
	useEffect(
		() => controls.setSeeThrough(seeThrough || view === "plan"),
		[seeThrough, view],
	);
	useEffect(() => controls.setLegKit(legKit), [legKit]);
	useEffect(() => controls.setHeadroom(headroom), [headroom]);
	useEffect(() => controls.setDryingLine(dryingLine), [dryingLine]);
	useEffect(() => controls.setHighQuality(highQuality), [highQuality]);

	return (
		<FloatingPanel
			open={panelOpen}
			onOpenChange={setPanelOpen}
			title="Gamme 8 PC"
			icon={Tent}
			className="max-h-[calc(100vh-1.5rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-auto"
		>
			<div className="flex flex-col gap-3 pt-1 pb-1">
				<p className="text-xs text-muted-foreground">
					Nortent Gamme 8 PC · Ø 432 cm · 216 cm high · 14.5 m². Everything at
					true size.
				</p>

				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					className="w-full"
					value={view}
					// Radix sends "" when the active item is clicked again; ignore it.
					onValueChange={(v) => v && setView(v as View)}
				>
					{VIEWS.map(([value, label, Icon]) => (
						<ToggleGroupItem
							key={value}
							value={value}
							// Five views: icon above the label so they fit.
							className="h-auto flex-1 flex-col gap-1 px-1 py-1.5 text-xs"
						>
							<Icon />
							{label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>

				{firstPerson && (
					<div className="flex items-center justify-between gap-2 text-sm">
						<span className="whitespace-nowrap text-muted-foreground">
							Walk as
						</span>
						<ToggleGroup
							type="single"
							variant="outline"
							size="sm"
							value={who}
							onValueChange={(v) => v && setWho(v as Who)}
						>
							<ToggleGroupItem value="you">
								You · {cm(PEOPLE.you)}
							</ToggleGroupItem>
							<ToggleGroupItem value="partner">
								Partner · {cm(PEOPLE.partner)}
							</ToggleGroupItem>
						</ToggleGroup>
					</div>
				)}

				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					className="w-full"
					value={season}
					onValueChange={(v) => v && setSeason(v as Season)}
				>
					{SEASON_ICONS.map(([value, Icon]) => (
						<ToggleGroupItem key={value} value={value} className="flex-1">
							<Icon />
							{SEASONS[value]}
						</ToggleGroupItem>
					))}
				</ToggleGroup>

				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					className="w-full"
					value={time}
					onValueChange={(v) => v && setTime(v as TimeOfDay)}
				>
					{TIMES.map(([value, label, Icon]) => (
						<ToggleGroupItem key={value} value={value} className="flex-1">
							<Icon />
							{label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>

				<div className="flex flex-col gap-2.5 rounded-md border p-3">
					<Setting
						id="front-door"
						label="Front door open"
						checked={frontDoor}
						onChange={setFrontDoor}
					/>
					<Setting
						id="back-door"
						label="Back door open"
						checked={backDoor}
						onChange={setBackDoor}
					/>
					<Setting
						id="see-through"
						label="See-through tent"
						checked={seeThrough}
						onChange={setSeeThrough}
					/>
					<Setting
						id="leg-kit"
						label={`Cots on leg extensions (${cm(COT.heightWithLegs)})`}
						checked={legKit}
						onChange={setLegKit}
					/>
					<Setting
						id="drying-line"
						label="Drying line with clothes"
						checked={dryingLine}
						onChange={setDryingLine}
					/>
					<Setting
						id="headroom"
						label="Headroom lines on the floor"
						checked={headroom}
						onChange={setHeadroom}
					/>
					{headroom && <HeadroomLegend />}
					<Setting
						id="high-quality"
						label="High quality rendering"
						checked={highQuality}
						onChange={setHighQuality}
					/>
				</div>

				{info && <Measurements info={info} />}

				<div className="flex items-center gap-2">
					<p className="flex-1 text-xs text-muted-foreground">
						{firstPerson
							? "Esc frees the mouse to use this panel."
							: "Drag gear to move it, Q / E to turn it."}
					</p>
					<Button asChild variant="secondary" size="sm" className="px-2.5">
						<a href="/" title="Back to the map" aria-label="Map">
							<MapIcon />
						</a>
					</Button>
					<Button
						variant="secondary"
						size="sm"
						className="px-2.5"
						onClick={fullscreen.toggle}
						title={fullscreen.on ? "Leave full screen" : "Full screen"}
						aria-label="Full screen"
					>
						{fullscreen.on ? <Minimize /> : <Maximize />}
					</Button>
					<Button variant="secondary" size="sm" onClick={controls.reset}>
						<RotateCcw />
						Reset
					</Button>
				</div>
			</div>
		</FloatingPanel>
	);
}

function Setting(props: {
	id: string;
	label: string;
	checked: boolean;
	onChange: (on: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-2 text-sm">
			<label htmlFor={props.id} className="cursor-pointer">
				{props.label}
			</label>
			<Switch
				id={props.id}
				checked={props.checked}
				onCheckedChange={props.onChange}
			/>
		</div>
	);
}

// The dashed lines drawn on the floor (tent.ts).
function HeadroomLegend() {
	const [[mine, red], [theirs, orange], ...rest] = HEADROOM;
	const lines = [
		[red, `${cm(mine)}: you stand upright`],
		[orange, `${cm(theirs)}: your partner stands upright`],
		[rest[0][1], rest.map(([h]) => cm(h)).join(" and ")],
	];
	return (
		<div className="flex flex-col gap-1 text-xs text-muted-foreground">
			{lines.map(([colour, label]) => (
				<span key={label} className="flex items-center gap-1.5">
					<span
						className="w-4 border-t-2 border-dashed"
						style={{ borderColor: colour }}
					/>
					{label}
				</span>
			))}
		</div>
	);
}

function Measurements({ info }: { info: Info }) {
	const stove = info.stove;
	if (!info.selected && !stove) return null;
	return (
		<div className="flex flex-col gap-1.5 rounded-md border p-3 text-sm">
			{info.selected ? (
				<>
					<span className="font-medium">{info.selected.name}</span>
					<span className="text-xs text-muted-foreground">
						{info.selected.size}
					</span>
					<Row
						label="Fabric above its centre"
						value={info.selected.fabricAbove}
					/>
				</>
			) : null}
			{info.selected && stove ? <div className="my-1 border-t" /> : null}
			{stove ? (
				<>
					<Row
						label="Stove to fabric"
						value={cm(stove.toFabric)}
						warn={stove.toFabric < 0.3}
					/>
					<Row
						label="Stove to nearest cot"
						value={cm(stove.toCot)}
						warn={stove.toCot < 0.3}
					/>
					<Row
						label="Pipe to stove jack"
						value={
							stove.pipeOffJack < 0.01
								? "lined up"
								: `${cm(stove.pipeOffJack)} off`
						}
						warn={stove.pipeOffJack >= 0.01}
					/>
				</>
			) : null}
		</div>
	);
}

function Row(props: { label: string; value: string; warn?: boolean }) {
	return (
		<div className="flex justify-between gap-2">
			<span className="text-muted-foreground">{props.label}</span>
			<span
				className={
					props.warn
						? "font-medium text-destructive tabular-nums"
						: "font-medium tabular-nums"
				}
			>
				{props.value}
			</span>
		</div>
	);
}

// The whole page in full screen, and whether it is.
function useFullscreen() {
	const [on, setOn] = useState(false);
	useEffect(() => {
		const update = () => setOn(document.fullscreenElement !== null);
		document.addEventListener("fullscreenchange", update);
		return () => document.removeEventListener("fullscreenchange", update);
	}, []);
	return {
		on,
		async toggle() {
			if (document.fullscreenElement) return document.exitFullscreen();
			await document.documentElement.requestFullscreen();
			// Normally Esc both frees the mouse and leaves full screen. Where
			// the browser allows it (Chrome, Edge), keep Esc for the page, so
			// it only frees the mouse; holding Esc still leaves full screen.
			await (
				navigator as { keyboard?: { lock(keys: string[]): Promise<void> } }
			).keyboard?.lock(["Escape"]);
		},
	};
}

// The interface follows the time of day in the scene: dark at night, so
// the panel doesn't glare over the dark tent, light otherwise.
function useDarkAtNight(time: TimeOfDay) {
	useEffect(() => {
		document.documentElement.classList.toggle("dark", time === "night");
	}, [time]);
}
