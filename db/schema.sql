-- Flat-ground results from the pipeline. Safe to run again (IF NOT EXISTS).

-- Tents from pipeline/tents.toml.
CREATE TABLE IF NOT EXISTS tent (
    slug text PRIMARY KEY, -- 'keron-4-gt'
    name text NOT NULL     -- 'Keron 4 GT'
);

-- One row per 10 m cell and tent, only for cells at most 10° steep.
CREATE TABLE IF NOT EXISTS cell (
    tent          text     NOT NULL, -- slug from tents.toml, e.g. 'keron-4-gt'
    tile          text     NOT NULL, -- work tile, e.g. 'E0220000_N6864000'
    x             integer  NOT NULL, -- south-west corner, EPSG:25833 metres
    y             integer  NOT NULL,
    max_slope_deg real     NOT NULL, -- steepest ground under the best placement
    heading_deg   smallint,          -- that placement's long side; NULL for round tents
    elevation_m   real     NOT NULL,
    -- The 10 m square itself, derived from x and y so the CSV doesn't carry
    -- geometry. Stored in UTM 33 (metres), like everything else.
    geom geometry(Polygon, 25833)
        GENERATED ALWAYS AS (ST_MakeEnvelope(x, y, x + 10, y + 10, 25833)) STORED,
    PRIMARY KEY (tent, x, y)
);

-- Spatial index: lets a map tile find its cells without scanning the table.
CREATE INDEX IF NOT EXISTS cell_geom_idx ON cell USING gist (geom);
-- For reloading one tile at a time.
CREATE INDEX IF NOT EXISTS cell_tile_idx ON cell (tile, tent);
