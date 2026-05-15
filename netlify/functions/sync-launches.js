/**
 * sync-launches
 *
 * Scheduled Netlify Function — runs every hour.
 * Fetches upcoming Starship launches from The Space Devs API (LL2)
 * and updates the `flights` table in Supabase with live NET dates, statuses,
 * and extended mission data (description, payload, orbit, launch window).
 *
 * Required env vars (set in Netlify → Site config → Environment variables):
 *   SUPABASE_URL              — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY — secret service role key (NOT the anon key)
 *
 * Optional schema columns (add to `flights` table to unlock enhanced display):
 *   launch_site        TEXT
 *   spacex_url         TEXT
 *   launch_time_utc    TIMESTAMPTZ   — full NET datetime
 *   window_start       TIMESTAMPTZ
 *   window_end         TIMESTAMPTZ
 *   mission_description TEXT
 *   mission_type       TEXT
 *   orbit              TEXT
 *   payload_description TEXT
 *   payload_mass_kg    NUMERIC
 */

const { createClient } = require('@supabase/supabase-js');

const LL2_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/'
  + '?rocket__configuration__name=Starship'
  + '&limit=10'
  + '&ordering=net';

// ── Map LL2 status abbreviations to our flight_status enum ──────────────────
const STATUS_MAP = {
  'Go':              'net',
  'TBC':             'net',
  'TBD':             'upcoming',
  'Hold':            'upcoming',
  'In Flight':       'launched',
  'Success':         'success',
  'Partial Failure': 'partial',
  'Failure':         'failure',
};

function mapStatus(abbrev) {
  return STATUS_MAP[abbrev] ?? 'upcoming';
}

// ── Parse flight number from names like:
//    "Starship | Integrated Flight Test 12"
//    "Starship | Flight Test 12"
// ────────────────────────────────────────────────────────────────────────────
function parseFlightNum(name) {
  const match = name.match(/[Ff]light(?:\s+[Tt]est)?\s+(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ── Truncate text to a maximum length ────────────────────────────────────────
function truncate(str, maxLen = 500) {
  if (!str) return null;
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async function () {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Fetch from LL2 ──────────────────────────────────────────────────────
  let launches;
  try {
    const res = await fetch(LL2_URL, {
      headers: { 'User-Agent': 'starship-watch/1.0 (fan tracker)' },
    });

    if (!res.ok) {
      throw new Error(`LL2 responded with ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    launches = data.results ?? [];
  } catch (err) {
    console.error('Failed to fetch from LL2:', err.message);
    return { statusCode: 502, body: `LL2 fetch error: ${err.message}` };
  }

  if (!launches.length) {
    console.log('LL2 returned no upcoming Starship launches');
    return { statusCode: 200, body: JSON.stringify({ synced: 0 }) };
  }

  // ── Sync each launch into Supabase ──────────────────────────────────────
  const results = [];

  for (const launch of launches) {
    const flightNum = parseFlightNum(launch.name);
    if (!flightNum) {
      console.warn(`Could not parse flight number from: "${launch.name}" — skipping`);
      continue;
    }

    const statusAbbrev = launch.status?.abbrev ?? 'TBD';
    const flightStatus = mapStatus(statusAbbrev);
    const netDate      = launch.net ? launch.net.split('T')[0] : null;
    const netConfirmed = ['Go', 'TBC'].includes(statusAbbrev);
    const spacexUrl    = launch.url ?? null;

    // ── Extended mission data from LL2 ──────────────────────────────────
    const launchTimeUtc    = launch.net ?? null;
    const windowStart      = launch.window_start ?? null;
    const windowEnd        = launch.window_end ?? null;
    const launchSite       = launch.pad?.location?.name
      ? `${launch.pad.name}, ${launch.pad.location?.name}`
      : (launch.pad?.name ?? null);
    const missionDesc      = truncate(launch.mission?.description ?? null);
    const missionType      = launch.mission?.type ?? null;
    const orbit            = launch.mission?.orbit?.name ?? null;

    // Payload: LL2 doesn't always expose individual payload mass, but we can
    // construct a description from mission info
    const payloadDesc = launch.mission?.name
      ? launch.mission.name !== launch.name.split('|')[0]?.trim()
        ? launch.mission.name
        : null
      : null;

    // ── Build update payload ─────────────────────────────────────────────
    // Core fields — always present in schema
    const coreUpdate = {
      status:        flightStatus,
      net_date:      netDate,
      net_confirmed: netConfirmed,
      spacex_url:    spacexUrl,
      launch_site:   launchSite,
    };

    // Extended fields — only present if schema has been updated
    const extendedUpdate = {
      launch_time_utc:     launchTimeUtc,
      window_start:        windowStart,
      window_end:          windowEnd,
      mission_description: missionDesc,
      mission_type:        missionType,
      orbit:               orbit,
      payload_description: payloadDesc,
    };

    // Try to update with all fields; if extended fields fail, fall back to core
    let error;

    ({ error } = await sb
      .from('flights')
      .update({ ...coreUpdate, ...extendedUpdate })
      .eq('flight_num', flightNum));

    if (error) {
      // Possibly missing extended columns — retry with core fields only
      console.warn(`Full update failed for IFT-${flightNum} (${error.message}), retrying with core fields only`);
      ({ error } = await sb
        .from('flights')
        .update(coreUpdate)
        .eq('flight_num', flightNum));
    }

    if (error) {
      console.warn(`Could not update flight ${flightNum}: ${error.message}`);
      results.push({ flightNum, ok: false, error: error.message });
    } else {
      console.log(`Updated IFT-${flightNum}: status=${flightStatus}, net=${netDate ?? 'TBD'}, orbit=${orbit ?? '-'}`);
      results.push({ flightNum, ok: true, status: flightStatus, net: netDate, orbit });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ synced: results.filter(r => r.ok).length, results }),
  };
};
