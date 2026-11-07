-- Flat-ground results from the pipeline. Safe to run again (IF NOT EXISTS).
SET client_min_messages = warning; -- no "already exists" notices on reruns

-- Tents from pipeline/tents.toml.
CREATE TABLE IF NOT EXISTS tent (
    slug text PRIMARY KEY, -- 'keron-4-gt'
    name text NOT NULL     -- 'Keron 4 GT'
);

-- The 10 m cells where a tent fits, in blocks of 8 × 8 cells (80 m), one
-- row per block and tent: a row per cell would spend more on Postgres's
-- per-row overhead (~30 bytes) than on the data. Blocks without any usable
-- cell aren't stored.
DO $$ BEGIN
    -- One-off: results became per season. Drop the old tables (and with
    -- them the bins view); the loader then loads everything again.
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'block')
       AND NOT EXISTS (SELECT FROM information_schema.columns
                       WHERE table_name = 'block' AND column_name = 'season') THEN
        DROP TABLE block, block_load CASCADE;
    END IF;
END $$;
CREATE TABLE IF NOT EXISTS block (
    tent   text    NOT NULL, -- tent slug, e.g. 'keron-4-gt'
    -- 'summer', or 'winter': snow-covered, so bogs are fine (see
    -- SUMMER_ONLY_KINDS in the engine).
    season text    NOT NULL,
    bx     integer NOT NULL, -- block column: x / 80, EPSG:25833 metres
    by     integer NOT NULL, -- block row: y / 80
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

-- The blocks' step counts summed into larger bins for zoomed-out map tiles:
-- 160 m at zoom 11, doubling with each zoom out to 10 km at zoom 5. (Zoom 12
-- reads the 80 m blocks directly.)
--
-- A materialized view: a query whose result Postgres stores like a table.
-- The loader recomputes it after each load with REFRESH MATERIALIZED VIEW
-- CONCURRENTLY, which builds the new result on the side, so the map keeps
-- reading the old bins meanwhile (~15 s).
--
-- Every block counts at every zoom. A bin at zoom z is 2^(12 − z) blocks
-- wide, and shifting the block number right by 12 − z bits divides it by
-- that (rounding down). The 20 counts are summed position by position.
DO $$ BEGIN
    -- One-off: bin used to be a table filled by a script.
    IF EXISTS (SELECT FROM pg_class WHERE relname = 'bin' AND relkind = 'r') THEN
        DROP TABLE bin;
    END IF;
END $$;
CREATE MATERIALIZED VIEW IF NOT EXISTS bin AS
SELECT b.tent,
       b.season,
       z::smallint AS zoom,
       b.bx >> (12 - z) AS bx, -- bin column: x / bin size
       b.by >> (12 - z) AS by, -- bin row: y / bin size
       ARRAY[
           sum(b.cells_up_to_step[1]), sum(b.cells_up_to_step[2]), sum(b.cells_up_to_step[3]), sum(b.cells_up_to_step[4]),
           sum(b.cells_up_to_step[5]), sum(b.cells_up_to_step[6]), sum(b.cells_up_to_step[7]), sum(b.cells_up_to_step[8]),
           sum(b.cells_up_to_step[9]), sum(b.cells_up_to_step[10]), sum(b.cells_up_to_step[11]), sum(b.cells_up_to_step[12]),
           sum(b.cells_up_to_step[13]), sum(b.cells_up_to_step[14]), sum(b.cells_up_to_step[15]), sum(b.cells_up_to_step[16]),
           sum(b.cells_up_to_step[17]), sum(b.cells_up_to_step[18]), sum(b.cells_up_to_step[19]), sum(b.cells_up_to_step[20])
       ]::integer[] AS cells_up_to_step -- as in block
FROM block b, generate_series(5, 11) AS z
GROUP BY b.tent, b.season, z, 4, 5;
-- The map's lookups, and REFRESH ... CONCURRENTLY needs a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS bin_key ON bin (tent, season, zoom, bx, by);

-- Which tile CSVs are loaded, so reloading skips what hasn't changed. Kept
-- in the database itself, so a fresh database simply loads everything.
CREATE TABLE IF NOT EXISTS block_load (
    tile       text   NOT NULL,
    tent       text   NOT NULL,
    season     text   NOT NULL,
    csv_mtime  bigint NOT NULL, -- the CSV's modification time when loaded
    PRIMARY KEY (tile, tent, season)
);
