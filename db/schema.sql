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
CREATE TABLE IF NOT EXISTS block (
    tent   text    NOT NULL, -- tent slug, e.g. 'keron-4-gt'
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
    PRIMARY KEY (tent, bx, by)
);

-- The blocks' step counts summed into larger bins for zoomed-out map tiles:
-- 160 m at zoom 11, doubling with each zoom out to 5. (Zoom 12 reads the
-- 80 m blocks directly.)
CREATE TABLE IF NOT EXISTS bin (
    tent           text      NOT NULL,
    zoom           smallint  NOT NULL,
    bx             integer   NOT NULL, -- bin column: x / bin size
    by             integer   NOT NULL, -- bin row: y / bin size
    cells_up_to_step integer[] NOT NULL, -- as in block
    PRIMARY KEY (tent, zoom, bx, by)
);

-- Which tile CSVs are loaded, so reloading skips what hasn't changed. Kept
-- in the database itself, so a fresh database simply loads everything.
CREATE TABLE IF NOT EXISTS block_load (
    tile       text   NOT NULL,
    tent       text   NOT NULL,
    csv_mtime  bigint NOT NULL, -- the CSV's modification time when loaded
    PRIMARY KEY (tile, tent)
);
