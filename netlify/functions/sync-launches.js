/**
 * sync-launches
 *
 * Scheduled Netlify Function — runs every hour.
 * Fetches upcoming Starship launches from The Space Devs API (LL2 v2.3.0)
 * and upserts them into the `flights` table in Supabase: existing rows are
 * updated, new launches are inserted automatically.
 */

const { createClient } = require('@supabase/supabase-js');

const LL2_URL = 'https://ll.thespacedevs.com/2.3.0/launches/upcoming/'
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

// Build the field payloads for one LL2 launch.
function buildPayloads(launch) {
  const flightNum    = parseFlightNum(launch.name);
  const statusAbbrev = launch.status?.abbrev ?? 'TBD';
  const missionName  = launch.mission?.name ?? null;
  // Prefer the clean mission name ("Flight 13", "Superbird-9") over the
  // pipe-delimited launch name ("Starship | Flight 13").
  const displayName  = missionName || launch.name;

  const launchSite = launch.pad?.location?.name
    ? `${launch.pad.name}, ${launch.pad.location.name}`
    : (launch.pad?.name ?? null);

  // Human-facing mission page (Space Launch Now, The Space Devs' frontend) —
  // launch.url is the raw JSON API resource, not a web page.
  const missionUrl = launch.slug
    ? `https://spacelaunchnow.me/launch/${launch.slug}/`
    : null;

  const core = {
    name:          displayName,
    status:        mapStatus(statusAbbrev),
    net_date:      typeof launch.net === 'string' ? launch.net.split('T')[0] : null,
    net_confirmed: ['Go', 'TBC'].includes(statusAbbrev),
    spacex_url:    missionUrl,
    launch_site:   launchSite,
  };

  const payloadDesc = missionName && missionName !== launch.name.split('|')[0]?.trim()
    ? missionName
    : null;

  const extended = {
    launch_time_utc:     launch.net ?? null,
    window_start:        launch.window_start ?? null,
    window_end:          launch.window_end ?? null,
    net_precision:       launch.net_precision?.name ?? null,
    mission_description: truncate(launch.mission?.description ?? null),
    mission_type:        launch.mission?.type ?? null,
    orbit:               launch.mission?.orbit?.name ?? null,
    payload_description: payloadDesc,
  };

  return { flightNum, displayName, core, extended };
}

/**
 * Update-or-insert one launch. Numbered flights match on flight_num;
 * unnumbered missions (Superbird-9, Starlab, ...) match on name.
 * Falls back to core-only fields if extended schema columns are missing.
 * Returns { action: 'updated'|'inserted'|'failed', mode, error? }.
 */
async function syncLaunch(sb, launch) {
  const { flightNum, displayName, core, extended } = buildPayloads(launch);

  const matchCol = flightNum ? 'flight_num' : 'name';
  const matchVal = flightNum ?? displayName;

  // ── Update pass (full → core fallback) ──
  let mode = 'full';
  let { data, error } = await sb
    .from('flights')
    .update({ ...core, ...extended })
    .eq(matchCol, matchVal)
    .select('id');

  if (error) {
    mode = 'core';
    console.warn(`Full update failed for ${displayName} (${error.message}); retrying with core fields`);
    ({ data, error } = await sb
      .from('flights')
      .update(core)
      .eq(matchCol, matchVal)
      .select('id'));
  }

  if (error) return { action: 'failed', mode, error: error.message };
  if (data.length > 0) return { action: 'updated', mode };

  // ── No matching row — insert (full → core fallback) ──
  const baseRow = flightNum ? { flight_num: flightNum } : {};
  mode = 'full';
  ({ error } = await sb.from('flights').insert({ ...baseRow, ...core, ...extended }));

  if (error) {
    mode = 'core';
    console.warn(`Full insert failed for ${displayName} (${error.message}); retrying with core fields`);
    ({ error } = await sb.from('flights').insert({ ...baseRow, ...core }));
  }

  if (error) return { action: 'failed', mode, error: error.message };
  return { action: 'inserted', mode };
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
    if (!launch || typeof launch !== 'object' || !launch.name) {
      console.warn('Skipping malformed launch entry');
      continue;
    }

    const label = launch.mission?.name ?? launch.name;
    const result = await syncLaunch(sb, launch);
    results.push({ name: label, ...result });

    if (result.action === 'failed') {
      console.warn(`Sync failed for ${label}: ${result.error}`);
    } else {
      console.log(`${result.action} ${label} (${result.mode} fields, net=${launch.net ?? 'TBD'})`);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      synced: results.filter(r => r.action !== 'failed').length,
      results,
    }),
  };
};
