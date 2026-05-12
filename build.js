/**
 * build.js — injects Supabase credentials from Netlify env vars into index.html
 * Replaces placeholder strings with real values at build time.
 * This keeps secrets out of the source code and git history.
 */
const fs = require('fs');

const url     = process.env.SUPABASE_URL      || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY env vars must be set in Netlify.');
  process.exit(1);
}

let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('SUPABASE_URL_PLACEHOLDER', url);
html = html.replace('SUPABASE_ANON_KEY_PLACEHOLDER', anonKey);
fs.writeFileSync('index.html', html);

console.log('✅ index.html patched with Supabase credentials.');
