-- Rebuilds the `bin` table (see schema.sql) from `block`. Run after loading.
--
-- Bins at tiles' edges hold blocks from several tiles, so the table is
-- rebuilt as a whole: zoom 11 from the 80 m blocks, then each coarser zoom
-- from the one below. Each bin holds 2 × 2 bins (or blocks) of the level
-- below: integer division by 2 finds the parent.
--
-- The step counts are arrays, summed position by position: the cells up to
-- 0.5° are the sum of the children's first elements, and so on. (Spelled out
-- for all 20 positions: much faster than turning the arrays into rows.)

BEGIN;
TRUNCATE bin;

DO $$
BEGIN
    FOR z IN REVERSE 11..5 LOOP
        INSERT INTO bin (tent, zoom, bx, by, cells_up_to_step)
        SELECT tent, z, bx / 2, by / 2,
               ARRAY[
                    sum(c[1]), sum(c[2]), sum(c[3]), sum(c[4]), sum(c[5]),
                    sum(c[6]), sum(c[7]), sum(c[8]), sum(c[9]), sum(c[10]),
                    sum(c[11]), sum(c[12]), sum(c[13]), sum(c[14]), sum(c[15]),
                    sum(c[16]), sum(c[17]), sum(c[18]), sum(c[19]), sum(c[20])
               ]::integer[]
        FROM (
            -- The level below: the blocks themselves for zoom 11.
            SELECT tent, bx, by, cells_up_to_step AS c FROM block WHERE z = 11
            UNION ALL
            SELECT tent, bx, by, cells_up_to_step FROM bin WHERE zoom = z + 1
        ) below
        GROUP BY tent, bx / 2, by / 2;
    END LOOP;
END $$;

COMMIT;
ANALYZE bin;
