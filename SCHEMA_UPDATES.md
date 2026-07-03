# Schema Updates — Enhanced Flight Data

**⚠️ This migration has not been run yet** (as of 2026-07-03 the live `flights`
table is missing all extended columns, which forces `sync-launches.js` into its
core-fields fallback and hides launch times, windows, and mission descriptions
on the dashboard).

Run everything below once in the **Supabase SQL editor**, in order.

## 1. Add extended columns to `flights`

```sql
ALTER TABLE flights
  ADD COLUMN IF NOT EXISTS launch_time_utc     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_start        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_end          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS net_precision       TEXT,
  ADD COLUMN IF NOT EXISTS mission_description TEXT,
  ADD COLUMN IF NOT EXISTS mission_type        TEXT,
  ADD COLUMN IF NOT EXISTS orbit               TEXT,
  ADD COLUMN IF NOT EXISTS payload_description TEXT,
  ADD COLUMN IF NOT EXISTS payload_mass_kg     NUMERIC;
```

`net_precision` stores LL2's NET precision name (`Second` … `Day`, `Week`,
`Month`, `Quarter`, `Year`). The frontend uses it to show "NET JULY 2026"
instead of a fake countdown when the date is only month-accurate.

## 2. Allow unnumbered missions

Commercial/one-off missions (Superbird-9, Starlab) have no IFT flight number.
If `flight_num` is `NOT NULL`, inserts for them will fail:

```sql
ALTER TABLE flights ALTER COLUMN flight_num DROP NOT NULL;
```

(Skip if `flight_num` is already nullable.)

## 3. Recreate the `next_launch` view

```sql
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
  f.net_precision,
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

## Existing core columns (reference)

| Column         | Type        | Notes                            |
|----------------|-------------|----------------------------------|
| id             | UUID/INT    | Primary key                      |
| flight_num     | INT         | IFT flight number (nullable)     |
| name           | TEXT        | Mission name                     |
| status         | TEXT        | flight_status enum               |
| net_date       | DATE        | No Earlier Than date             |
| net_confirmed  | BOOLEAN     | Whether NET is confirmed         |
| spacex_url     | TEXT        | Mission details page URL         |
| launch_site    | TEXT        | Launch pad/site name             |

## Notes

- Both `sync-launches.js` and the frontend gracefully degrade if these columns
  are missing — but you lose launch times, windows, descriptions, and accurate
  NET-precision display until the migration runs.
- After running the SQL, trigger a sync to backfill the new columns:
  `curl https://starshipwatch.com/.netlify/functions/sync-launches`
