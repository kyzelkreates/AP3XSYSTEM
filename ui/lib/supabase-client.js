// AP3X — Supabase Client Singleton
// Reads credentials from localStorage (set via Settings panel).
// Used by fleet-os.html (Fleet Dashboard) and pwa (Driver PWA).
// NO mock data. NO fallback datasets. Live Supabase only.

const SETTINGS_KEY = "ap3x_supabase_settings";

let _client = null;

/**
 * Return saved Supabase settings from localStorage.
 * @returns {{ url: string, anonKey: string } | null}
 */
export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.url && s.anonKey) return s;
    return null;
  } catch { return null; }
}

/**
 * Save Supabase settings to localStorage.
 */
export function saveSettings(url, anonKey) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() }));
  _client = null; // force re-init on next getClient()
}

/**
 * Returns a lightweight Supabase client object.
 * Uses the @supabase/supabase-js CDN build loaded by the HTML page.
 * Throws if credentials are not configured.
 */
export function getClient() {
  if (_client) return _client;

  const settings = getSettings();
  if (!settings) {
    throw new Error("Supabase credentials not configured. Open Settings and enter your URL and anon key.");
  }

  if (typeof window.supabase === "undefined") {
    throw new Error("Supabase JS library not loaded. Check CDN script tag.");
  }

  _client = window.supabase.createClient(settings.url, settings.anonKey);
  return _client;
}

/**
 * Returns true if credentials are saved.
 */
export function isConfigured() {
  return getSettings() !== null;
}
