/**
 * get-nsf-video
 *
 * HTTP Netlify Function — returns the latest NASASpaceflight YouTube video ID.
 * Fetches the channel's public RSS feed (no API key required).
 * Detects live streams via title heuristics.
 *
 * GET /.netlify/functions/get-nsf-video
 * Response: { videoId: string|null, title: string|null, isLive: boolean }
 */

const NSF_CHANNEL_ID = 'UCSUu1lih2RifWkKtDOJdsBA';
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${NSF_CHANNEL_ID}`;
const FETCH_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=180',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const res = await fetchWithTimeout(RSS_URL, {
      headers: { 'User-Agent': 'starship-watch/1.0 (fan tracker)' },
    });

    if (!res.ok) {
      throw new Error(`YouTube RSS responded with ${res.status}`);
    }

    const xml = await res.text();

    const videoIdMatch = xml.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    // The first <title> is the channel; the first <entry>'s <title> is the latest video.
    const entryMatch = xml.match(/<entry>[\s\S]*?<title>([^<]+)<\/title>/);
    const title = entryMatch ? decodeEntities(entryMatch[1].trim()) : null;

    const liveKeywords = ['LIVE', 'live stream', 'Live Coverage', 'Launch Live', 'Watching Live'];
    const isLive = title
      ? liveKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()))
      : false;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ videoId, title, isLive }),
    };
  } catch (err) {
    console.error('get-nsf-video error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ videoId: null, title: null, isLive: false, error: err.message }),
    };
  }
};
