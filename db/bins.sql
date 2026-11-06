-- Rebuilds the `bin` table (see schema.sql) from `cell`. Run after loading.
--
-- Bins at different tiles' edges overlap tiles, so the table is rebuilt as a
-- whole: count the cells into 80 m bins once, then build each coarser zoom
-- from the one below by merging 2 × 2 bins.

BEGIN;
TRUNCATE bin;

-- Zoom 12: 80 m bins, counted from the cells. Slope step: 1 for up to 1°,
-- then one step per 0.5°, so 1.2° → step 2, 10° → step 19.
INSERT INTO bin (tent, zoom, bx, by, step, cells)
SELECT tent, 12, x / 80, y / 80,
       greatest(1, ceil(max_slope_deg * 2)::int - 1),
       count(*)
FROM cell
GROUP BY 1, 2, 3, 4, 5;

-- Zooms 11 down to 7: each bin is twice as wide, so it holds 2 × 2 bins of
-- the zoom below. Integer division by 2 finds the parent bin.
DO $$
BEGIN
    FOR z IN REVERSE 11..7 LOOP
        INSERT INTO bin (tent, zoom, bx, by, step, cells)
        SELECT tent, z, bx / 2, by / 2, step, sum(cells)
        FROM bin
        WHERE zoom = z + 1
        GROUP BY 1, 2, 3, 4, 5;
    END LOOP;
END $$;

COMMIT;
ANALYZE bin;
