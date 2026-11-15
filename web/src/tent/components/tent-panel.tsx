import {
	Armchair,
	Bed,
	ChevronDown,
	Flower,
	Footprints,
	LayoutGrid,
	Leaf,
	Map as MapIcon,
	Maximize,
	Minimize,
	Moon,
	Mountain,
	RotateCcw,
	RotateCw,
	Snowflake,
	Sun,
	Sunset,
	Tent,
} from "lucide-react";
import { Collapsible } from "radix-ui";
import { useEffect, useState } from "react";

import { FloatingPanel } from "#/components/floating-panel";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import type { Season } from "#/tent/landscape";
import type { TimeOfDay } from "#/tent/lighting";
import { controls, type Info, listeners, type View } from "#/tent/scene";
import { COT, cm, PEOPLE } from "#/tent/specs";
import { HEADROOM } from "#/tent/tent";
import { touchOnly } from "#/tent/touch";

const VIEWS: [View, string, typeof Mountain][] = [
	["outside", "Outside", Mountain],
	["walk", "Walk", Footprints],
	["sit", "Sit", Armchair],
	["lie", "Lie", Bed],
	["plan", "Plan", LayoutGrid],
];

// Summer: the table. Fall and winter: the stove, with the plateau under
// snow in winter.
const SEASON_BUTTONS: [Season, string, typeof Sun][] = [
	["summer", "Summer", Flower],
	["fall", "Fall", Leaf],
	["winter", "Winter", Snowflake],
];

const TIMES: [TimeOfDay, string, typeof Sun][] = [
	["day", "Day", Sun],
	["evening", "Evening", Sunset],
	["night", "Night", Moon],
];

type Who = keyof typeof PEOPLE;

// The floating panel in the top-left corner, as on the map.
export function TentPanel(props: {
	measure: boolean;
	onMeasureChange: (on: boolean) => void;
}) {
	// Kept in the address, so a reload or a shared link opens the same view.
	const [view, setView] = useInAddress<View>("view", VIEWS, "sit");
	const [time, setTime] = useInAddress<TimeOfDay>("time", TIMES, "day");
	const [season, setSeason] = useInAddress<Season>(
		"season",
		SEASON_BUTTONS,
		"fall",
	);
	const [who, setWho] = useState<Who>("you");
	const [doors, setDoors] = useState(["front"]);
	const [seeThrough, setSeeThrough] = useState(false);
	const [headroom, setHeadroom] = useState(true);
	const [dryingLine, setDryingLine] = useState(false);
	const [legKit, setLegKit] = useState(false);
	const [highQuality, setHighQuality] = useState(true);
	const fullscreen = useFullscreen();
	// Folded down while you look around with the mouse; open again when Esc
	// frees the mouse to use it.
	// Folded at first on a phone, where it would cover most of the view.
	const [panelOpen, setPanelOpen] = useState(
		() => !window.matchMedia("(max-width: 640px)").matches,
	);
	useEffect(() => {
		const update = () => setPanelOpen(document.pointerLockElement === null);
		document.addEventListener("pointerlockchange", update);
		return () => document.removeEventListener("pointerlockchange", update);
	}, []);
	// Walking, sitting and lying are all seen through your own eyes.
	const firstPerson = view === "walk" || view === "sit" || view === "lie";
	const [info, setInfo] = useState<Info>(null);

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
		() => controls.setDoors(doors.includes("front"), doors.includes("back")),
		[doors],
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
			className="w-[22rem]"
		>
			<div className="flex flex-col gap-3 pt-3 pb-1">
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
					{SEASON_BUTTONS.map(([value, label, Icon]) => (
						<ToggleGroupItem key={value} value={value} className="flex-1">
							<Icon />
							{label}
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

				<div className="flex items-center justify-between gap-2 text-sm">
					<span className="text-muted-foreground">Doors open</span>
					<ToggleGroup
						type="multiple"
						variant="outline"
						size="sm"
						value={doors}
						onValueChange={setDoors}
					>
						<ToggleGroupItem value="front">Front</ToggleGroupItem>
						<ToggleGroupItem value="back">Back</ToggleGroupItem>
					</ToggleGroup>
				</div>

				{/* The switches you rarely change, folded away. */}
				<Collapsible.Root className="rounded-md border">
					<Collapsible.Trigger className="group flex w-full items-center justify-between p-3 text-sm">
						More
						<ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
					</Collapsible.Trigger>
					<Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
						<div className="flex flex-col gap-2.5 px-3 pb-3">
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
								title={`Dashed lines where the roof is ${HEADROOM.map(([h]) => cm(h)).join(", ")} high: red where you stand upright, orange where your partner does`}
								checked={headroom}
								onChange={setHeadroom}
							/>
							<Setting
								id="measure"
								label="Room above your head"
								title="While walking, sitting or lying: how much room there is above your head, or above your face lying down"
								checked={props.measure}
								onChange={props.onMeasureChange}
							/>
							<Setting
								id="high-quality"
								label="High quality rendering"
								checked={highQuality}
								onChange={setHighQuality}
							/>
						</div>
					</Collapsible.Content>
				</Collapsible.Root>

				{info && <Selected item={info} />}

				<div className="flex items-center gap-2">
					<p className="flex-1 text-xs text-muted-foreground">
						{/* Looking around on a phone is explained at the bottom. */}
						{!firstPerson
							? "Drag gear to move it."
							: !touchOnly && "Esc frees the mouse to use this panel."}
					</p>
					<Button asChild variant="secondary" size="sm" className="px-2.5">
						<a href="/" title="Back to the map" aria-label="Map">
							<MapIcon />
						</a>
					</Button>
					{/* iPhones don't let a page go full screen. */}
					{document.fullscreenEnabled && (
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
					)}
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
	title?: string;
	checked: boolean;
	onChange: (on: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-2 text-sm">
			<label htmlFor={props.id} title={props.title} className="cursor-pointer">
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

// The gear you picked: its name and size, how much roof there is above
// it, and buttons to turn it.
function Selected({ item }: { item: NonNullable<Info> }) {
	return (
		<div className="flex flex-col gap-1.5 rounded-md border p-3 text-sm">
			<div className="flex items-center gap-2">
				<span className="flex-1 font-medium">{item.name}</span>
				{/* Q and E on a keyboard. */}
				<Button
					variant="outline"
					size="icon-sm"
					onClick={() => controls.turnSelected(1)}
					title="Turn left (Q)"
					aria-label="Turn left"
				>
					<RotateCcw />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					onClick={() => controls.turnSelected(-1)}
					title="Turn right (E)"
					aria-label="Turn right"
				>
					<RotateCw />
				</Button>
			</div>
			<span className="text-xs text-muted-foreground">{item.size}</span>
			<div className="flex justify-between gap-2">
				<span className="text-muted-foreground">Fabric above its centre</span>
				<span className="font-medium tabular-nums">{item.fabricAbove}</span>
			</div>
		</div>
	);
}

// A choice kept in the page address as `?key=value`: read from it at
// first, written back on every change. `choices` are the buttons it comes
// from; anything else in the address falls back to `start`.
function useInAddress<T extends string>(
	key: string,
	choices: [T, ...unknown[]][],
	start: T,
) {
	const [value, setValue] = useState<T>(() => {
		const given = new URLSearchParams(window.location.search).get(key);
		return choices.find(([choice]) => choice === given)?.[0] ?? start;
	});
	useEffect(() => {
		const url = new URL(window.location.href);
		url.searchParams.set(key, value);
		window.history.replaceState(null, "", url);
	}, [key, value]);
	return [value, setValue] as const;
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
