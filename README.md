# StarshipWatch 🚀

**StarshipWatch** is a real-time tracking dashboard for upcoming SpaceX Starship
flights. It shows the next launch with countdown, upcoming flight cards,
booster/ship hardware pipeline, and NASASpaceflight's latest/live YouTube stream.

**Live:** [starshipwatch.com](https://starshipwatch.com)

## How it works

```
LL2 API (thespacedevs) ──► sync-launches.js (hourly cron) ──► Supabase ──► frontend
YouTube RSS ──► get-nsf-video.js (on demand, 3 min cache) ─────────────────► frontend
```

1. **Ingestion** — `netlify/functions/sync-launches.js` runs hourly, fetches
   upcoming Starship launches from The Space Devs LL2 API (v2.3.0), and
   upserts them into the Supabase `flights` table (updates existing rows,
   inserts new launches automatically).
2. **Storage** — Supabase (PostgreSQL) is the source of truth. See
   [SCHEMA_UPDATES.md](SCHEMA_UPDATES.md) for the schema and required migration.
3. **Frontend** — a static page (`index.html` + `assets/`) reads directly from
   Supabase with the public anon key (read access controlled by RLS policies)
   and auto-refreshes every 60 seconds.

## Project layout

```
index.html                        markup
assets/css/styles.css             styles
assets/js/config.js               constants (Supabase creds injected at build)
assets/js/app.js                  frontend logic (ES module)
build.js                          injects env vars into config.js at deploy
netlify/functions/sync-launches.js  hourly LL2 → Supabase sync
netlify/functions/get-nsf-video.js  latest NSF YouTube video endpoint
netlify.toml                      build + cron config
```

## Setup

1. Clone and `npm install`.
2. Create a Supabase project, create the `flights`, `boosters`, `ships`,
   `flight_assignments` tables and the `next_launch` view, and run the
   migration in [SCHEMA_UPDATES.md](SCHEMA_UPDATES.md). Enable RLS with public
   read policies on those tables.
3. Set env vars in Netlify (see [.env.example](.env.example)):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Deploy — Netlify runs `npm install && node build.js` and schedules
   `sync-launches` hourly (`0 * * * *` in `netlify.toml`).

Local dev: `netlify dev` (requires the Netlify CLI) serves the site and
functions together.

## License

MIT — see [LICENSE](LICENSE).

*Not affiliated with, authorized, or endorsed by SpaceX.*
