/**
 * sync-launches
 *
 * Scheduled Netlify Function — runs every hour.
 * Fetches upcoming Starship launches from The Space Devs API (LL2)
 * and updates the `flights` table in Supabase.
 */

const { createClient } = require('@supabase/supabase-js');

const LL2_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/'
  + '?rocket__configuration__name=Starship'
  + '&limit=10'
  + '&ordering=net';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;

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

// Match: "Flight Test 12", "Integrated Flight Test 12", "IFT-12", "IFT 12", "Flight 12"
function parseFlightNum(name) {
  if (!name || typeof name !== 'string') return null;
  const patterns = [
    /\bIFT[-\s]?(\d+)\b/i,
    /\b(?:Integrated\s+)?Flight(?:\s+Test)?\s+(\d+)\b/i,
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function truncate(str, maxLen = 500) {
  if (!str) return null;
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLL2WithRetry() {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(LL2_URL, {
        headers: { 'User-Agent': 'starship-watch/1.0 (fan tracker)' },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`LL2 transient ${res.status}: ${res.statusText}`);
      }
      if (!res.ok) {
        throw new Error(`LL2 responded with ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.results)) {
        throw new Error('LL2 response missing results array');
      }
      return data.results;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.warn(`LL2 fetch attempt ${attempt} failed (${err.message}); retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

exports.handler = async function () {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return { statusCode: 500, body: 'Missing environment variables' };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let launches;
  try {
    launches = await fetchLL2WithRetry();
  } catch (err) {
    console.error('Failed to fetch from LL2:', err.message);
    return { statusCode: 502, body: `LL2 fetch error: ${err.message}` };
  }

  if (!launches.length) {
    console.log('LL2 returned no upcoming Starship launches');
    return { statusCode: 200, body: JSON.stringify({ synced: 0 }) };
  }

  const results = [];

  for (const launch of launches) {
    if (!launch || typeof launch !== 'object') {
      console.warn('Skipping malformed launch entry');
      continue;
    }

    const flightNum = parseFlightNum(launch.name);
    if (!flightNum) {
      console.warn(`Could not parse flight number from: "${launch.name}" — skipping`);
      continue;
    }

    const statusAbbrev = launch.status?.abbrev ?? 'TBD';
    const flightStatus = mapStatus(statusAbbrev);
    const netDate      = typeof launch.net === 'string' ? launch.net.split('T')[0] : null;
    const netConfirmed = ['Go', 'TBC'].includes(statusAbbrev);
    const spacexUrl    = launch.url ?? null;

    const launchTimeUtc    = launch.net ?? null;
    const windowStart      = launch.window_start ?? null;
    const windowEnd        = launch.window_end ?? null;
    const launchSite       = launch.pad?.location?.name
      ? `${launch.pad.name}, ${launch.pad.location.name}`
      : (launch.pad?.name ?? null);
    const missionDesc      = truncate(launch.mission?.description ?? null);
    const missionType      = launch.mission?.type ?? null;
    const orbit            = launch.mission?.orbit?.name ?? null;

    const payloadDesc = launch.mission?.name
      ? launch.mission.name !== launch.name.split('|')[0]?.trim()
        ? launch.mission.name
        : null
      : null;

    const coreUpdate = {
      status:        flightStatus,
      net_date:      netDate,
      net_confirmed: netConfirmed,
      spacex_url:    spacexUrl,
      launch_site:   launchSite,
    };

    const extendedUpdate = {
      launch_time_utc:     launchTimeUtc,
      window_start:        windowStart,
      window_end:          windowEnd,
      mission_description: missionDesc,
      mission_type:        missionType,
      orbit:               orbit,
      payload_description: payloadDesc,
    };

    let error;
    ({ error } = await sb
      .from('flights')
      .update({ ...coreUpdate, ...extendedUpdate })
      .eq('flight_num', flightNum));

    if (error) {
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
