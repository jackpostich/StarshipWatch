import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  NSF_YOUTUBE_URL,
  REFRESH_INTERVAL_SEC,
  NSF_FETCH_TIMEOUT_MS,
  LAUNCH_SITE_TZ,
} from './config.js';

// Supabase UMD bundle loaded via <script> in index.html — exposes window.supabase.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Timezone & formatting helpers ────────────────────────────────────────────
const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getTZAbbr(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'short',
    }).formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : '';
  } catch { return ''; }
}

function formatTimeInTZ(date, tz) {
  return date.toLocaleTimeString('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatDateUpper(date, tz) {
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  }).toUpperCase();
}

function buildTimezoneString(launchTimeUtc, netDate) {
  // Date-only NET: clock times would be fiction, so show just the date.
  if (!launchTimeUtc) {
    if (!netDate) return '';
    const d = new Date(netDate + 'T12:00:00Z');
    return isNaN(d) ? '' : formatDateUpper(d, 'UTC');
  }

  const d = new Date(launchTimeUtc);
  if (isNaN(d)) return '';

  const launchTime = formatTimeInTZ(d, LAUNCH_SITE_TZ);
  const launchAbbr = getTZAbbr(d, LAUNCH_SITE_TZ);
  const localTime  = formatTimeInTZ(d, userTZ);
  const localAbbr  = getTZAbbr(d, userTZ);
  const utcTime    = formatTimeInTZ(d, 'UTC');
  const dateUpper  = formatDateUpper(d);

  let str = `${dateUpper} · ${launchTime} ${launchAbbr} (LAUNCH SITE)`;
  if (userTZ !== LAUNCH_SITE_TZ) {
    str += ` · ${localTime} ${localAbbr} (YOUR TIME)`;
  }
  str += ` · ${utcTime} UTC`;
  return str;
}

function buildWindowString(windowStart, windowEnd) {
  if (!windowStart || !windowEnd) return null;
  try {
    const ws = new Date(windowStart);
    const we = new Date(windowEnd);
    if (isNaN(ws) || isNaN(we)) return null;
    const openUTC  = formatTimeInTZ(ws, 'UTC');
    const closeUTC = formatTimeInTZ(we, 'UTC');
    const openLocal  = formatTimeInTZ(ws, userTZ);
    const closeLocal = formatTimeInTZ(we, userTZ);
    const localAbbr  = getTZAbbr(ws, userTZ);
    return `WINDOW ${openUTC}–${closeUTC} UTC · ${openLocal}–${closeLocal} ${localAbbr}`;
  } catch { return null; }
}

function pad(n) { return String(n).padStart(2, '0'); }

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(dateStr) {
  if (!dateStr) return 'TBD';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).toUpperCase();
}

function fmtDatetime(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d)) return null;
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }).toUpperCase() + ' · ' + formatTimeInTZ(d, 'UTC') + ' UTC';
  } catch { return null; }
}

// ── Countdown ────────────────────────────────────────────────────────────────
let countdownTarget = null;
let countdownTimer  = null;

// LL2 net_precision names precise enough that a ticking countdown is honest.
const PRECISE_ENOUGH = ['Second', 'Minute', 'Hour', 'Day'];

// For vague NETs ("Month", "Quarter", "Year"), show a plain NET label instead
// of counting down to a placeholder instant.
function vagueNetLabel(precision, launchTimeUtc, netDate) {
  const d = launchTimeUtc ? new Date(launchTimeUtc) : (netDate ? new Date(netDate + 'T12:00:00Z') : null);
  if (!d || isNaN(d)) return 'DATE TBD';
  const year = d.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'UTC' });
  if (precision === 'Week' || precision === 'Month') {
    const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase();
    return `NET ${month} ${year}`;
  }
  return `NET ${year}`;
}

function startCountdown(launchTimeUtc, netDate, netPrecision) {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  // Vague NET (month/quarter/year precision) — a countdown would be fiction.
  if (netPrecision && !PRECISE_ENOUGH.includes(netPrecision)) {
    const el = document.getElementById('countdown-el');
    if (el) {
      el.innerHTML = `<span style="font-size:20px;font-weight:300;letter-spacing:0.1em;color:var(--text-secondary)">${escHtml(vagueNetLabel(netPrecision, launchTimeUtc, netDate))}</span>`;
    }
    countdownTarget = null;
    return;
  }

  if (launchTimeUtc) {
    countdownTarget = new Date(launchTimeUtc);
  } else if (netDate) {
    // Date-only NET: noon UTC as a neutral placeholder instant.
    countdownTarget = new Date(netDate + 'T12:00:00Z');
  } else {
    countdownTarget = null;
  }

  function tick() {
    const el = document.getElementById('countdown-el');
    if (!el) return;

    if (!countdownTarget || isNaN(countdownTarget)) {
      el.innerHTML = '<span style="font-size:14px;font-weight:300;color:rgba(255,255,255,0.3)">DATE TBD</span>';
      return;
    }

    const diff = countdownTarget - Date.now();
    if (diff <= 0) {
      // Within a day of T-0 the launch is plausibly in progress; beyond that
      // the row is stale (sync hasn't marked it launched yet) — say so
      // instead of showing "window open" indefinitely.
      el.innerHTML = diff > -86400000
        ? '<span style="font-size:14px;font-weight:300;color:var(--green)">T-0 — LAUNCH WINDOW OPEN</span>'
        : '<span style="font-size:14px;font-weight:300;color:var(--text-muted)">AWAITING SCHEDULE UPDATE</span>';
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      return;
    }

    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000)  / 60000);
    const secs  = Math.floor((diff % 60000)    / 1000);

    el.innerHTML = `
      <div class="cd-block"><div class="cd-value">${pad(days)}</div><div class="cd-label">DAYS</div></div>
      <div class="cd-sep">:</div>
      <div class="cd-block"><div class="cd-value">${pad(hours)}</div><div class="cd-label">HOURS</div></div>
      <div class="cd-sep">:</div>
      <div class="cd-block"><div class="cd-value">${pad(mins)}</div><div class="cd-label">MINS</div></div>
      <div class="cd-sep">:</div>
      <div class="cd-block"><div class="cd-value">${pad(secs)}</div><div class="cd-label">SECS</div></div>
    `;
  }

  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ── Status indicator ─────────────────────────────────────────────────────────
const STATUS_DOT = {
  upcoming:   'dot-blue',
  net:        'dot-yellow',
  scrubbed:   'dot-red',
  launched:   'dot-green',
  success:    'dot-green',
  partial:    'dot-yellow',
  failure:    'dot-red',
  planned:    'dot-gray',
  production: 'dot-gray',
  stacking:   'dot-yellow',
  stacked:    'dot-yellow',
  testing:    'dot-yellow',
  ready:      'dot-green',
  retired:    'dot-gray',
  destroyed:  'dot-red',
};

function statusHtml(status, label) {
  const dot = STATUS_DOT[status] ?? 'dot-gray';
  return `<div class="status-indicator"><span class="status-dot ${dot}"></span>${label ?? status}</div>`;
}

// ── NSF YouTube ──────────────────────────────────────────────────────────────
async function fetchNSFVideo() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NSF_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch('/.netlify/functions/get-nsf-video', { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    console.warn('Could not fetch NSF video:', e.message);
    return { videoId: null, title: null, isLive: false };
  } finally {
    clearTimeout(timer);
  }
}

function buildEmbedHtml(videoData) {
  const { videoId, title, isLive } = videoData || {};

  if (!videoId) {
    return `
      <div class="video-label">
        <div class="video-label-left">
          <span class="live-dot live-dot-gray"></span>
          <span>NASASPACEFLIGHT</span>
        </div>
        <a href="${NSF_YOUTUBE_URL}" target="_blank" rel="noopener" class="video-source-link">→ YouTube</a>
      </div>
      <div class="embed-placeholder">
        <div class="embed-placeholder-inner">
          <div class="embed-placeholder-text">No live stream detected</div>
          <a href="${NSF_YOUTUBE_URL}" target="_blank" rel="noopener" class="watch-btn">WATCH ON YOUTUBE →</a>
        </div>
      </div>`;
  }

  const dotClass = isLive ? 'live-dot' : 'live-dot live-dot-gray';
  const labelText = isLive ? 'LIVE · NASASPACEFLIGHT' : 'LATEST · NASASPACEFLIGHT';
  const titleHtml = title
    ? `<div class="video-title-display">${escHtml(title)}</div>`
    : '';

  return `
    <div class="video-label">
      <div class="video-label-left">
        <span class="${dotClass}"></span>
        <span>${labelText}</span>
      </div>
      <a href="${NSF_YOUTUBE_URL}" target="_blank" rel="noopener" class="video-source-link">→ Channel</a>
    </div>
    ${titleHtml}
    <div class="embed-wrapper">
      <iframe
        src="https://www.youtube.com/embed/${escHtml(videoId)}?autoplay=1&mute=1&rel=0&modestbranding=1"
        title="NASASpaceflight"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    </div>
    <div class="muted-notice">▶ Autoplaying muted · Click to unmute</div>`;
}

// ── Render: Banner ───────────────────────────────────────────────────────────
function renderBanner(row, videoData) {
  const banner = document.getElementById('banner');

  if (!row) {
    banner.innerHTML = `
      <div class="hero-inner">
        <div class="hero-left">
          <div class="hero-label"><div class="hero-dot"></div> NEXT LAUNCH</div>
          <div class="hero-title">STAY TUNED</div>
          <div class="hero-subtitle" style="color:var(--text-muted)">No upcoming flights scheduled</div>
        </div>
        <div class="hero-right">${buildEmbedHtml(videoData)}</div>
      </div>`;
    return;
  }

  const parts = [];
  if (row.launch_site) parts.push(row.launch_site);
  if (row.booster_serial) {
    let b = row.booster_serial;
    if (row.booster_version) b += ` (${row.booster_version})`;
    parts.push(b);
  }
  if (row.ship_serial) parts.push(row.ship_serial);

  const tzStr     = buildTimezoneString(row.launch_time_utc, row.net_date);
  const winStr    = buildWindowString(row.window_start, row.window_end);
  const missionDesc = row.mission_description || null;
  const orbit       = row.orbit || null;
  const missionType = row.mission_type || null;

  const pills = [];
  if (row.status === 'net' || row.net_confirmed) {
    pills.push(`<span class="meta-pill meta-pill-green">GO FOR LAUNCH</span>`);
  }
  if (orbit)        pills.push(`<span class="meta-pill">${escHtml(orbit)}</span>`);
  if (missionType)  pills.push(`<span class="meta-pill">${escHtml(missionType)}</span>`);
  if (row.booster_version) pills.push(`<span class="meta-pill meta-pill-accent">${escHtml(row.booster_version)}</span>`);

  banner.innerHTML = `
    <div class="hero-inner">
      <div class="hero-left">
        <div class="hero-label"><div class="hero-dot"></div> NEXT LAUNCH</div>
        <div class="hero-title">${escHtml((row.name || '').toUpperCase())}</div>
        <div class="hero-subtitle">
          ${parts.map((p, i) => `<span>${escHtml(p)}</span>${i < parts.length - 1 ? '<span class="hero-sep">/</span>' : ''}`).join('')}
        </div>
        ${pills.length ? `<div class="hero-meta">${pills.join('')}</div>` : ''}
        ${missionDesc ? `<div class="hero-mission-desc">${escHtml(missionDesc)}</div>` : ''}
        ${tzStr ? `<div class="hero-timezone">${escHtml(tzStr)}</div>` : ''}
        ${winStr ? `<div class="hero-timezone" style="margin-top:-12px;font-size:10px;">${escHtml(winStr)}</div>` : ''}
        <div class="countdown" id="countdown-el"></div>
      </div>
      <div class="hero-right">${buildEmbedHtml(videoData)}</div>
    </div>
  `;

  startCountdown(row.launch_time_utc, row.net_date, row.net_precision);
}

// ── Render: Flight Cards ─────────────────────────────────────────────────────
function buildHwMap(assignments) {
  const hwMap = {};
  for (const a of assignments) {
    if (!a.is_primary) continue;
    hwMap[a.flight_id] = { booster: a.boosters, ship: a.ships };
  }
  return hwMap;
}

// Card designator: "IFT-13" for numbered flights, mission type for the rest
// (Superbird-9, Starlab, ... have no flight number).
function flightDesignator(f) {
  if (f.flight_num) return `IFT-${f.flight_num}`;
  return (f.mission_type || 'MISSION').toUpperCase();
}

function renderFlights(flights, assignments) {
  const grid = document.getElementById('flights-grid');

  if (!flights.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);font-size:12px;font-weight:300;padding:32px;">No upcoming flights found.</p>';
    grid.style.background = 'none';
    grid.style.border = 'none';
    return;
  }

  const hwMap = buildHwMap(assignments);

  grid.innerHTML = flights.map((f) => {
    const hw      = hwMap[f.id] ?? {};
    const booster = hw.booster;
    const ship    = hw.ship;
    const statusLabel = f.status === 'net' ? `NET ${fmtDate(f.net_date)}` : f.status;

    const metaTags = [];
    if (f.orbit)        metaTags.push(escHtml(f.orbit));
    if (f.mission_type) metaTags.push(escHtml(f.mission_type));
    if (f.payload_description) metaTags.push(escHtml(f.payload_description.slice(0, 30)));

    const launchTimeStr = fmtDatetime(f.launch_time_utc);

    const boosterHtml = booster ? `
      <div class="hw-row">
        <span class="hw-icon-char">B</span>
        <span class="hw-serial">${escHtml(booster.serial)}</span>
        ${booster.version ? `<span class="hw-version">${escHtml(booster.version)}</span>` : ''}
        ${booster.notes ? `<span class="hw-note">${escHtml(booster.notes)}</span>` : ''}
      </div>` : '';

    const shipHtml = ship ? `
      <div class="hw-row">
        <span class="hw-icon-char">S</span>
        <span class="hw-serial">${escHtml(ship.serial)}</span>
        ${ship.notes ? `<span class="hw-note">${escHtml(ship.notes)}</span>` : ''}
      </div>` : '';

    return `
      <div class="flight-card">
        <div class="flight-header">
          <div>
            <div class="flight-num">${escHtml(flightDesignator(f))}</div>
            <div class="flight-name">${escHtml(f.name)}</div>
          </div>
          ${statusHtml(f.status, statusLabel)}
        </div>
        ${f.mission_description ? `<div class="flight-mission-desc">${escHtml(f.mission_description)}</div>` : ''}
        ${metaTags.length ? `<div class="flight-meta-row">${metaTags.map(t => `<span class="flight-meta-tag">${t}</span>`).join('')}</div>` : ''}
        <div class="hw-rows">
          ${boosterHtml}
          ${shipHtml}
          ${!boosterHtml && !shipHtml ? '<div class="hw-row" style="color:var(--text-muted);font-size:12px;font-weight:300;">Hardware TBD</div>' : ''}
        </div>
        <div class="flight-date-row">
          <span>${f.status === 'net' ? 'NET' : 'EST'}</span>
          <strong>${launchTimeStr || fmtDate(f.net_date)}</strong>
        </div>
      </div>`;
  }).join('');
}

// ── Render: Pipeline ─────────────────────────────────────────────────────────
function renderPipeline(boosters, ships) {
  const bCol = document.getElementById('boosters-col');
  const sCol = document.getElementById('ships-col');

  const pipeItem = (serial, statusStr, pct, flightNum, version) => `
    <div class="pipeline-item">
      <div class="pipe-serial">${escHtml(serial)}</div>
      <div class="pipe-info">
        <div style="display:flex;align-items:center;gap:8px;">
          ${statusHtml(statusStr, statusStr)}
          ${version ? `<span class="pipe-version">${escHtml(version)}</span>` : ''}
        </div>
        <div class="pipe-progress"><div class="pipe-progress-fill" style="width:${pct ?? 0}%"></div></div>
      </div>
      ${flightNum ? `<div class="pipe-flight">IFT-${flightNum}</div>` : ''}
    </div>`;

  bCol.innerHTML = '<h3>SUPER HEAVY BOOSTERS</h3>' +
    (boosters.length
      ? boosters.map(b => pipeItem(b.serial, b.status, b.progress_pct, b.flights?.flight_num, b.version)).join('')
      : '<p style="font-size:12px;color:var(--text-muted);font-weight:300;">No data.</p>');

  sCol.innerHTML = '<h3>STARSHIP VEHICLES</h3>' +
    (ships.length
      ? ships.map(s => pipeItem(s.serial, s.status, s.progress_pct, s.flights?.flight_num, null)).join('')
      : '<p style="font-size:12px;color:var(--text-muted);font-weight:300;">No data.</p>');
}

// ── Auto-refresh progress bar ────────────────────────────────────────────────
let refreshElapsed = 0;
let refreshBarTimer = null;

function updateRefreshBar() {
  refreshElapsed++;
  const bar = document.getElementById('refresh-bar');
  const pct = Math.min((refreshElapsed / REFRESH_INTERVAL_SEC) * 100, 100);
  bar.style.width = pct + '%';

  if (refreshElapsed >= REFRESH_INTERVAL_SEC) {
    refreshElapsed = 0;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    requestAnimationFrame(() => { bar.style.transition = 'width 1s linear'; });
    loadAll();
  }
}

function startRefreshBar() {
  if (refreshBarTimer) clearInterval(refreshBarTimer);
  refreshElapsed = 0;
  document.getElementById('refresh-bar').style.width = '0%';
  refreshBarTimer = setInterval(updateRefreshBar, 1000);
}

// ── Live intel ticker ────────────────────────────────────────────────────────
// Replaces the hardcoded placeholder items with lines built from current data.
function renderTicker(flights, assignments) {
  if (!flights.length) return;
  const track = document.getElementById('ticker-track');
  if (!track) return;

  const hwMap = buildHwMap(assignments);

  const items = flights.map(f => {
    const bits = [];
    bits.push(`Status: ${(f.status === 'net' ? 'GO / NET' : f.status).toUpperCase()}`);
    if (f.net_precision && !PRECISE_ENOUGH.includes(f.net_precision)) {
      bits.push(vagueNetLabel(f.net_precision, f.launch_time_utc, f.net_date));
    } else if (f.launch_time_utc) {
      bits.push(`NET ${fmtDatetime(f.launch_time_utc)}`);
    } else if (f.net_date) {
      bits.push(`NET ${fmtDate(f.net_date)}`);
    } else {
      bits.push('Date TBD');
    }
    if (f.launch_site) bits.push(f.launch_site);
    const hw = hwMap[f.id];
    if (hw?.booster?.serial || hw?.ship?.serial) {
      bits.push([hw.booster?.serial, hw.ship?.serial].filter(Boolean).join(' + '));
    }
    if (f.orbit) bits.push(f.orbit);
    const label = flightDesignator(f) === 'MISSION' ? f.name : `${flightDesignator(f)} · ${f.name}`;
    return `<span class="intel-item"><span>${escHtml(label.toUpperCase())}</span> · ${bits.map(escHtml).join(' · ')}</span>`;
  });

  // Duplicate once for the seamless CSS marquee loop.
  track.innerHTML = items.join('') + items.join('');
}

// ── Flights query — extended columns with core fallback ─────────────────────
// The extended columns only exist after the SCHEMA_UPDATES.md migration has
// been run in Supabase; fall back to core columns so the grid still renders.
const FLIGHT_COLS_CORE = 'id, flight_num, name, status, net_date, net_confirmed, launch_site';
const FLIGHT_COLS_FULL = FLIGHT_COLS_CORE
  + ', launch_time_utc, window_start, window_end, net_precision'
  + ', mission_description, mission_type, orbit, payload_description';

async function fetchFlights() {
  const query = cols => sb.from('flights')
    .select(cols)
    .in('status', ['upcoming', 'net'])
    .order('net_date', { ascending: true, nullsFirst: false })
    .order('flight_num', { ascending: true });

  let res = await query(FLIGHT_COLS_FULL);
  if (res.error && /does not exist/i.test(res.error.message ?? '')) {
    console.warn('Extended flight columns missing — run SCHEMA_UPDATES.md migration. Falling back to core columns.');
    res = await query(FLIGHT_COLS_CORE);
  }
  return res;
}

// ── Load everything ──────────────────────────────────────────────────────────
async function loadAll() {
  const now = new Date();
  document.getElementById('last-updated').textContent =
    'UPDATED ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

  const [
    nsfVideoData,
    bannerRes,
    flightsRes,
    assignRes,
    boostersRes,
    shipsRes,
  ] = await Promise.all([
    fetchNSFVideo(),
    // maybeSingle: zero rows → data:null (renders the "STAY TUNED" state)
    // instead of the PGRST116 error .single() would raise.
    sb.from('next_launch').select('*').maybeSingle(),
    fetchFlights(),
    sb.from('flight_assignments')
      .select('flight_id, is_primary, boosters(serial, version, notes, status), ships(serial, status, notes)')
      .eq('is_primary', true),
    sb.from('boosters')
      .select('serial, version, status, progress_pct, notes, flights(flight_num)')
      .order('serial', { ascending: true }),
    sb.from('ships')
      .select('serial, status, progress_pct, notes, flights(flight_num)')
      .order('serial', { ascending: true }),
  ]);

  if (bannerRes.error) {
    console.warn('next_launch query failed:', bannerRes.error.message);
    document.getElementById('banner').innerHTML =
      '<div class="error-msg" role="alert">Could not load next launch data.</div>';
  } else {
    renderBanner(bannerRes.data, nsfVideoData);
  }

  const flightsGrid = document.getElementById('flights-grid');
  if (flightsRes.error || assignRes.error) {
    console.warn('flights query failed:', flightsRes.error?.message, assignRes.error?.message);
    document.getElementById('error-flights').style.display = 'block';
    flightsGrid.innerHTML = '';
    flightsGrid.style.background = 'none';
    flightsGrid.style.border = 'none';
  } else {
    document.getElementById('error-flights').style.display = 'none';
    renderFlights(flightsRes.data ?? [], assignRes.data ?? []);
    renderTicker(flightsRes.data ?? [], assignRes.data ?? []);
  }

  if (boostersRes.error || shipsRes.error) {
    console.warn('pipeline query failed:', boostersRes.error?.message, shipsRes.error?.message);
    document.getElementById('error-pipeline').style.display = 'block';
    document.getElementById('boosters-col').innerHTML = '<h3>SUPER HEAVY BOOSTERS</h3>';
    document.getElementById('ships-col').innerHTML = '<h3>STARSHIP VEHICLES</h3>';
  } else {
    document.getElementById('error-pipeline').style.display = 'none';
    renderPipeline(boostersRes.data ?? [], shipsRes.data ?? []);
  }
}

loadAll();
startRefreshBar();
