// Links to photos of the ground, to check a spot before going.

// Google's satellite photos of a map view.
export function googleSatelliteUrl(lat: number, lon: number, zoom: number) {
	return `https://www.google.com/maps/@${lat},${lon},${Math.round(zoom)}z/data=!3m1!1e3`;
}

// Norge i bilder: Kartverket's aerial photos, sharp enough to see the
// ground (10–25 cm per pixel), opened in 3D. It can't be a layer here (its
// map services need a licence), but its website is free and takes a box in
// UTM 33 in its URL.
//
// A view around a point given in UTM 33 metres (EPSG:25833), close enough
// to see the ground: about twice the area across (its side is √m2), at
// least 80 × 60 m.
export function norgeIBilderUrl(x: number, y: number, m2: number) {
	const half = Math.round(Math.max(40, Math.sqrt(m2)));
	const [w, h] = [half, Math.round(half * 0.75)];
	const box = `xmin=${x - w}&xmax=${x + w}&ymin=${y - h}&ymax=${y + h}`;
	return `https://norgeibilder.no/?wkid=25833&is3d=true&${box}`;
}
