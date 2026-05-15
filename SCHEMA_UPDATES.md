# Schema Updates — Enhanced Flight Data

The `sync-launches.js` function now syncs additional mission fields from the LL2 API.
To enable the enhanced display in the dashboard, add these columns to your Supabase `flights` table.

## SQL Migration

Run this in the Supabase SQL editor:

```sql
-- Enhanced mission data columns for flights table
ALTER TABLE flights
  ADD COLUMN IF NOT EXISTS launch_time_utc   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_start      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_end        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mission_description TEXT,
  ADD COLUMN IF NOT EXISTS mission_type      TEXT,
  ADD COLUMN IF NOT EXISTS orbit             TEXT,
  ADD COLUMN IF NOT EXISTS payload_description TEXT,
  ADD COLUMN IF NOT EXISTS payload_mass_kg   NUMERIC;
```

## Existing Columns (reference)

These columns should already exist:

| Column         | Type        | Notes                            |
|----------------|-------------|----------------------------------|
| id             | UUID/INT    | Primary key                      |
| flight_num     | INT         | IFT flight number                |
| name           | TEXT        | Mission name                     |
| status         | TEXT        | flight_status enum               |
| net_date       | DATE        | No Earlier Than date             |
| net_confirmed  | BOOLEAN     | Whether NET is confirmed         |
| spacex_url     | TEXT        | SpaceX mission page URL          |
| launch_site    | TEXT        | Launch pad/site name             |

## `next_launch` View

If you have a `next_launch` database view, ensure it includes the new columns:

```sql
-- Example: recreate the next_launch view to include new fields
CREATE OR REPLACE VIEW next_launch AS
SELECT
  f.id,
  f.flight_num,
  f.name,
  f.status,
  f.net_date,
  f.net_confirmed,
  f.spacex_url,
  f.launch_site,
  f.launch_time_utc,
  f.window_start,
  f.window_end,
  f.mission_description,
  f.mission_type,
  f.orbit,
  f.payload_description,
  b.serial   AS booster_serial,
  b.version  AS booster_version,
  s.serial   AS ship_serial
FROM flights f
LEFT JOIN flight_assignments fa ON fa.flight_id = f.id AND fa.is_primary = true
LEFT JOIN boosters b ON b.id = fa.booster_id
LEFT JOIN ships s    ON s.id = fa.ship_id
WHERE f.status IN ('net', 'upcoming')
ORDER BY f.net_date ASC NULLS LAST, f.flight_num ASC
LIMIT 1;
```

## Notes

- The `sync-launches.js` function gracefully handles missing columns — it falls back to core fields only if the extended update fails.
- The frontend (`index.html`) also handles missing fields gracefully — it only shows them if they're present in the data.
