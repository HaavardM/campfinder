// Every real-world size in the scene, in metres. One unit in three.js is
// one metre, so nothing is scaled anywhere else.
//
// "Published" figures come from the maker or retailer spec sheets.
// "Estimate" figures are not published; they are read off product photos
// and are the ones to double-check against the real thing.

// Nortent Gamme 8 PC (polycotton).
// Published: Ø 432 cm, 216 cm high, 14.5 m² floor, 2 doors, 4 vents high
// up and 2 low.
// A dome 4.32 m across and 2.16 m high is a hemisphere of radius 2.16 m.
// The fabric is held out at 10 evenly spaced points round the base and
// bows in a little between them, which is why the floor is 14.5 m² and not
// the 14.7 m² of a full circle.
export const TENT = {
	radius: 4.32 / 2,
	// How round the fabric is between the 10 points: 0 is a flat decagon
	// (13.7 m² floor), 1 is a full circle (14.7 m²). 0.8 gives ~14.5 m².
	roundness: 0.8,
	// The frame, from the owner's description and product photos: 5 poles.
	// Three long poles cross at the top: one landing either side of each
	// door, and a middle one at right angles to the doors. Two cross poles
	// each start about 50 cm (13.4° round the base) to one side of the
	// middle pole's foot on one side wall, arch over
	// one door, clearing its top at about 1.97 m, and come down next to the middle pole's foot
	// on the other wall. Near their starts they cross each other in a low X
	// in the middle of each side wall, as far from the doors as possible.
	// Each pole runs on the dome from a foot at compass angle `from` to one
	// at `to`, over its highest point at angle `over`, `up` degrees above
	// the ground (90 is the apex). Angles are degrees from the front door
	// (+x) towards +z. Exact angles: estimate.
	poles: [
		{ from: 18, to: 198, over: 0, up: 90 }, // by the doors, along their straight sides
		{ from: 332, to: 152, over: 0, up: 90 }, // by the doors, past their curved sides
		{ from: 90, to: 270, over: 0, up: 90 }, // middle, across the doors
		{ from: 76.6, to: 283.4, over: 180, up: 66 }, // cross pole over the back door
		{ from: 103.4, to: 256.6, over: 0, up: 66 }, // cross pole over the front door
	],
	// The doors, from Nortent's drawing: one straight side running up along a
	// door pole to the top, and a curved side sweeping from the top down to
	// the ground, like a quarter ellipse. `edge` is the straight side's
	// compass angle from the door's centre; `width` the opening along the
	// ground, `height` at the straight side. Sizes read off the drawing:
	// estimate.
	door: { edge: 16, width: 1.5, height: 1.85 },
	// The stove jack sits just above the back door (-x), high up near the
	// top, as in Nortent's drawing. Estimate: its height is not published.
	stoveJackHeight: 2.08,
};

// Helinox Cot One Convertible Long.
// Published: 210 × 68 cm, 17 cm high. The Leg Extension accessory raises
// it to 38 cm.
export const COT = {
	length: 2.1,
	width: 0.68,
	heightLow: 0.17,
	heightWithLegs: 0.38,
	legFrames: 3,
};

// Winnerwell Nomad View, L size.
// Published: body 460 × 250 × 250 mm, 500 × 650 mm footprint with the side
// shelves out, Ø 89 mm (3.5") pipe in 430 mm sections, 2.74 m from the
// ground to the top of the spark arrester.
export const STOVE = {
	bodyLength: 0.46,
	bodyWidth: 0.25,
	bodyHeight: 0.25,
	widthWithShelves: 0.65,
	// Estimate: leg height is not published. 2.74 m total minus the pipe
	// stack puts the body bottom at roughly this height.
	legHeight: 0.22,
	pipeDiameter: 0.089,
	totalHeight: 2.74,
};

// Generic hot tent kit. Sizes are typical of the common products named.
export const FURNITURE = {
	// Helinox Chair One: 52 × 50 cm footprint, 66 cm high, seat 34 cm.
	chair: { width: 0.52, depth: 0.5, height: 0.66, seat: 0.34 },
	// Helinox Table One: 60 × 40 cm, 39 cm high.
	table: { width: 0.6, depth: 0.4, height: 0.39 },
	// A bigger camp table for summer, where the stove stands in winter.
	// Helinox Table Two size, about 80 × 60 cm and 42 cm high (estimate).
	bigTable: { width: 0.8, depth: 0.6, height: 0.42 },
	// Heat-resistant mat under the stove.
	fireMat: { length: 1.0, width: 0.6 },
	// A box of split birch.
	woodBox: { length: 0.45, width: 0.32, height: 0.3 },
	// Reindeer hide on the floor.
	hide: { length: 1.4, width: 1.0 },
	// 90 L duffel.
	duffel: { length: 0.7, diameter: 0.36 },
};

// The two of you, for scale.
export const PEOPLE = {
	you: 1.95,
	partner: 1.8,
};

// Eye height in each pose when walking around, for someone 195 cm tall.
// Scaled by height for anyone else. Lying is different: on your back on a
// cot, eyes are this far above the cot's bed (pad, pillow, head),
// whoever you are.
export const EYES = {
	standing: 1.83,
	sitting: 1.2, // on a chair
	lying: 0.28, // above the cot
};

// Metres as a label in whole centimetres: 1.953 → "195 cm".
export const cm = (m: number) => `${Math.round(m * 100)} cm`;
