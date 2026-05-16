/**
 * build.js — injects Supabase credentials from Netlify env vars into the
 * client-side config module. Replaces placeholder strings at build time.
 */
const fs = require('fs');
const path = require('path');

const url     = process.env.SUPABASE_URL      || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY env vars must be set in Netlify.');
  process.exit(1);
}

const configPath = path.join(__dirname, 'assets', 'js', 'config.js');
let src = fs.readFileSync(configPath, 'utf8');

if (!src.includes('SUPABASE_URL_PLACEHOLDER') || !src.includes('SUPABASE_ANON_KEY_PLACEHOLDER')) {
  console.error('ERROR: config.js is missing one or both placeholders. Has it already been built?');
  process.exit(1);
}

src = src.replace('SUPABASE_URL_PLACEHOLDER', url);
src = src.replace('SUPABASE_ANON_KEY_PLACEHOLDER', anonKey);
fs.writeFileSync(configPath, src);

console.log('✅ assets/js/config.js patched with Supabase credentials.');
