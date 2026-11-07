// GET /map/<file>: the map's files (manifest.json and the .pmtiles files),
// from the R2 bucket bound as MAP (see wrangler.toml). Everything else is
// the site's static files, which Cloudflare serves without this Worker.
//
// The map files are too big for static assets (25 MiB per file), hence R2.
// It answers HTTP range requests ("Range: bytes=1000-1999"), which is how
// the map reads a PMTiles file: a few kilobytes per tile, never the whole
// file.

type Env = { MAP: R2Bucket };

export default {
	async fetch(request, env) {
		// Requests for a missing static file that isn't a page load end up
		// here too: those aren't map files.
		const path = new URL(request.url).pathname;
		if (!path.startsWith("/map/")) return new Response("Not found", { status: 404 });
		const key = path.slice("/map/".length);
		// R2 reads the Range header itself and returns only those bytes.
		const object = await env.MAP.get(key, { range: request.headers });
		if (!object) return new Response("Not found", { status: 404 });

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set("etag", object.httpEtag);
		headers.set("accept-ranges", "bytes");
		// A .pmtiles file's name holds a hash of its content, so it never
		// changes: keep it. The manifest changes in place with every upload:
		// always ask.
		headers.set(
			"cache-control",
			key.endsWith(".pmtiles") ? "public, max-age=31536000, immutable" : "no-cache",
		);

		const range = object.range;
		if (!request.headers.has("range") || !range) {
			return new Response(object.body, { headers });
		}
		// Which bytes these are, as "bytes first-last/size": either the last
		// `suffix` bytes, or `length` bytes from `offset`. Read as plain optional
		// fields, not narrowed with `"suffix" in range`: R2 can return the key
		// `suffix` set to undefined, which made that check give NaN.
		const { offset, length: count, suffix } = range as {
			offset?: number;
			length?: number;
			suffix?: number;
		};
		const first = suffix !== undefined ? object.size - suffix : (offset ?? 0);
		const length = suffix ?? count ?? object.size - first;
		headers.set("content-range", `bytes ${first}-${first + length - 1}/${object.size}`);
		return new Response(object.body, { status: 206, headers });
	},
} satisfies ExportedHandler<Env>;
