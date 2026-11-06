-- Flat-ground results from the pipeline. Safe to run again (IF NOT EXISTS).
SET client_min_messages = warning; -- no "already exists" notices on reruns

-- Tents from pipeline/tents.toml.
CREATE TABLE IF NOT EXISTS tent (
    slug text PRIMARY KEY, -- 'keron-4-gt'
    name text NOT NULL     -- 'Keron 4 GT'
);

-- One row per 10 m cell and tent, only for cells at most 10° steep
-- (MAX_STORED_SLOPE_DEG in the engine).
CREATE TABLE IF NOT EXISTS cell (
    tent          text     NOT NULL, -- tent slug, e.g. 'keron-4-gt'
    x             integer  NOT NULL, -- south-west corner, EPSG:25833 metres
    y             integer  NOT NULL,
    max_slope_deg real     NOT NULL, -- steepest ground under the best placement
    heading_deg   smallint,          -- that placement's long side; NULL for round tents
    elevation_m   real     NOT NULL,
    PRIMARY KEY (tent, x, y)
);

-- Map tiles read these instead of the cells. Per tent and zoom level, the
-- cells are counted in square bins (80 m at zoom 12, doubling with each zoom
-- out) and split by slope into 0.5° steps:
-- step 1 = up to 1°, step 2 = up to 1.5°, …, step 19 = up to 10°.
-- A tile can then score any max slope from these counts alone.
CREATE TABLE IF NOT EXISTS bin (
    tent  text     NOT NULL,
    zoom  smallint NOT NULL,
    bx    integer  NOT NULL, -- bin column: x / bin size
    by    integer  NOT NULL, -- bin row: y / bin size
    step  smallint NOT NULL,
    cells integer  NOT NULL,
    PRIMARY KEY (tent, zoom, bx, by, step)
);

-- Which tile CSVs are loaded, so reloading skips what hasn't changed. Kept
-- in the database itself, so a fresh database simply loads everything.
CREATE TABLE IF NOT EXISTS cell_load (
    tile       text   NOT NULL,
    tent       text   NOT NULL,
    csv_mtime  bigint NOT NULL, -- the CSV's modification time when loaded
    PRIMARY KEY (tile, tent)
);
