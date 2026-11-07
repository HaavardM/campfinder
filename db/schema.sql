-- Flat-ground results from the pipeline. Safe to run again (IF NOT EXISTS).
SET client_min_messages = warning; -- no "already exists" notices on reruns

-- One-off: these tables used to be called block, bin and block_load, and had
-- no season. Drop them; the loader then loads everything again.
DO $$ BEGIN
    IF to_regclass('bin') IS NOT NULL THEN
        EXECUTE CASE (SELECT relkind FROM pg_class WHERE oid = to_regclass('bin'))
            WHEN 'm' THEN 'DROP MATERIALIZED VIEW bin'
            ELSE 'DROP TABLE bin'
        END;
    END IF;
    DROP TABLE IF EXISTS block, block_load;
END $$;

-- Tents from pipeline/tents.toml.
CREATE TABLE IF NOT EXISTS tent (
    slug text PRIMARY KEY, -- 'keron-4-gt'
    name text NOT NULL     -- 'Keron 4 GT'
);

-- The spots: the 10 m cells where a tent fits, in squares of 8 × 8 cells
-- (80 m), one row per square, tent and season. A row per cell would spend
-- more on Postgres's per-row overhead (~30 bytes) than on the data. Squares
-- without any spot aren't stored.
CREATE TABLE IF NOT EXISTS spots_80m (
    tent   text    NOT NULL, -- tent slug, e.g. 'keron-4-gt'
    -- 'summer', or 'winter': snow-covered, so bogs are fine (see
    -- SUMMER_ONLY_KINDS in the engine).
    season text    NOT NULL,
    bx     integer NOT NULL, -- square column: x / 80, EPSG:25833 metres
    by     integer NOT NULL, -- square row: y / 80
    -- 64 bytes, one per cell, row by row from the south-west corner: the
    -- steepest ground under the best placement, in tenths of a degree
    -- (0–100); 255 where no tent fits or it's steeper than 10°.
    slopes bytea   NOT NULL,
    -- How many of the cells are up to 0.5°, 1°, 1.5°, … 10° steep: element k
    -- (from 1) counts cells up to 0.5·k degrees. The map's zoomed-out score
    -- needs only these counts, and at max slope m reads element 2·m.
    cells_up_to_step integer[] NOT NULL,
    PRIMARY KEY (tent, season, bx, by)
);

-- The spot counts summed into larger squares for zoomed-out map tiles:
-- 160 m at zoom 11, doubling with each zoom out to 10 km at zoom 5. (Zoom 12
-- reads the 80 m squares directly.)
--
-- A materialized view: a query whose result Postgres stores like a table.
-- The loader recomputes it after each load with REFRESH MATERIALIZED VIEW
-- CONCURRENTLY, which builds the new result on the side, so the map keeps
-- reading the old counts meanwhile (~15 s).
--
-- Every 80 m square counts at every zoom. A square at zoom z is 2^(12 − z)
-- of them wide, and shifting their numbers right by 12 − z bits divides by
-- that (rounding down). The 20 counts are summed position by position.
CREATE MATERIALIZED VIEW IF NOT EXISTS spot_counts AS
SELECT s.tent,
       s.season,
       z::smallint AS zoom,
       s.bx >> (12 - z) AS bx, -- square column: x / square size
       s.by >> (12 - z) AS by, -- square row: y / square size
       ARRAY[
           sum(s.cells_up_to_step[1]), sum(s.cells_up_to_step[2]), sum(s.cells_up_to_step[3]), sum(s.cells_up_to_step[4]),
           sum(s.cells_up_to_step[5]), sum(s.cells_up_to_step[6]), sum(s.cells_up_to_step[7]), sum(s.cells_up_to_step[8]),
           sum(s.cells_up_to_step[9]), sum(s.cells_up_to_step[10]), sum(s.cells_up_to_step[11]), sum(s.cells_up_to_step[12]),
           sum(s.cells_up_to_step[13]), sum(s.cells_up_to_step[14]), sum(s.cells_up_to_step[15]), sum(s.cells_up_to_step[16]),
           sum(s.cells_up_to_step[17]), sum(s.cells_up_to_step[18]), sum(s.cells_up_to_step[19]), sum(s.cells_up_to_step[20])
       ]::integer[] AS cells_up_to_step -- as in spots_80m
FROM spots_80m s, generate_series(5, 11) AS z
GROUP BY s.tent, s.season, z, 4, 5;
-- The map's lookups, and REFRESH ... CONCURRENTLY needs a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS spot_counts_key ON spot_counts (tent, season, zoom, bx, by);

-- Which result files (one per tile, tent and season) are loaded, so
-- reloading skips what hasn't changed. Kept in the database itself, so a
-- fresh database simply loads everything.
CREATE TABLE IF NOT EXISTS loaded_files (
    tile       text   NOT NULL,
    tent       text   NOT NULL,
    season     text   NOT NULL,
    csv_mtime  bigint NOT NULL, -- the file's modification time when loaded
    PRIMARY KEY (tile, tent, season)
);
