/**
 * get-nsf-video
 *
 * HTTP Netlify Function — returns the latest NASASpaceflight YouTube video ID.
 * Fetches the channel's public RSS feed (no API key required).
 * Also detects if there's a live stream currently active.
 *
 * GET /.netlify/functions/get-nsf-video
 *
 * Response: { videoId: string|null, title: string|null, isLive: boolean }
 */

const NSF_CHANNEL_ID = 'UCSUu1lih2RifWkKtDOJdsBA';
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${NSF_CHANNEL_ID}`;

// YouTube Data API search for live streams (no key needed for public RSS)
// We'll check if the latest video is a live stream by looking at the title/description heuristics

exports.handler = async function (event, context) {
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=180', // cache 3 minutes
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const res = await fetch(RSS_URL, {
      headers: { 'User-Agent': 'starship-watch/1.0 (fan tracker)' },
    });

    if (!res.ok) {
      throw new Error(`YouTube RSS responded with ${res.status}`);
    }

    const xml = await res.text();

    // Extract the first (latest) video entry
    const videoIdMatch = xml.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/);
    const titleMatch   = xml.match(/<title>([^<]+)<\/title>/g);

    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    // The first <title> is the channel title, second is the latest video title
    let title = null;
    if (titleMatch && titleMatch.length >= 2) {
      title = titleMatch[1].replace(/<\/?title>/g, '').trim();
    }

    // Heuristic: detect live streams by common title patterns
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
