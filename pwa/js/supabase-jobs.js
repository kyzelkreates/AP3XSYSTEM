// AP3X Driver PWA — Supabase Jobs Module
// Reads job assignments directly from Supabase for the authenticated driver.
// NO mock data. NO fallback datasets. Live Supabase only.
//
// Query rule:
//   job_assignments WHERE driver_id = auth.user.id
//   AND status IN ("assigned", "in_progress")
//   JOIN jobs ON job_id

const SB_SETTINGS_KEY = "ap3x_supabase_settings";
let _sbClient = null;
let _assignmentChannel = null;

// ─── CLIENT ───────────────────────────────────────────────────────────────────

function _getClient() {
  if (_sbClient) return _sbClient;
  try {
    const raw = localStorage.getItem(SB_SETTINGS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.url || !s.anonKey) return null;
    if (typeof window.supabase === "undefined") return null;
    _sbClient = window.supabase.createClient(s.url, s.anonKey);
    return _sbClient;
  } catch { return null; }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

/**
 * Get the authenticated Supabase user.
 * Returns null if not authenticated.
 */
export async function getAuthUser() {
  const sb = _getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user || null;
}

/**
 * Confirm the current user has role = "driver".
 * Reads from profiles table.
 */
export async function confirmDriverRole(userId) {
  const sb = _getClient();
  if (!sb || !userId) return false;
  const { data, error } = await sb
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (error || !data) return false;
  return data.role === "driver";
}

// ─── JOB ASSIGNMENTS ──────────────────────────────────────────────────────────

/**
 * Fetch active job assignments for a driver.
 * Returns array of { assignment_id, job_id, driver_id, vehicle_id, status,
 *                    title, pickup_location, dropoff_location, created_at }
 */
export async function fetchDriverAssignments(driverId) {
  const sb = _getClient();
  if (!sb || !driverId) return [];

  const { data, error } = await sb
    .from("job_assignments")
    .select(`
      id,
      job_id,
      driver_id,
      vehicle_id,
      status,
      created_at,
      jobs (
        id,
        title,
        pickup_location,
        dropoff_location,
        status
      )
    `)
    .eq("driver_id", driverId)
    .in("status", ["assigned", "in_progress"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[SB Jobs] fetchDriverAssignments error:", error.message);
    return [];
  }

  return (data || []).map(a => ({
    assignment_id:    a.id,
    job_id:           a.job_id,
    driver_id:        a.driver_id,
    vehicle_id:       a.vehicle_id,
    status:           a.status,
    assigned_at:      a.created_at,
    title:            a.jobs?.title            || "Untitled Job",
    pickup_location:  a.jobs?.pickup_location  || "—",
    dropoff_location: a.jobs?.dropoff_location || "—",
  }));
}

// ─── STATUS UPDATES ───────────────────────────────────────────────────────────

/**
 * Update job assignment status.
 * @param {string} assignmentId - UUID from job_assignments.id
 * @param {"in_progress"|"rejected"|"completed"} newStatus
 */
export async function updateAssignmentStatus(assignmentId, newStatus) {
  const sb = _getClient();
  if (!sb) return { error: "Not connected to Supabase" };

  const { error } = await sb
    .from("job_assignments")
    .update({ status: newStatus })
    .eq("id", assignmentId);

  if (error) {
    console.error("[SB Jobs] updateAssignmentStatus error:", error.message);
    return { error: error.message };
  }
  return { success: true };
}

// ─── REALTIME ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to live assignment changes for a driver.
 * @param {string} driverId
 * @param {function} onUpdate - called with fresh assignments array
 */
export function subscribeToAssignments(driverId, onUpdate) {
  const sb = _getClient();
  if (!sb || !driverId) return;

  // Unsubscribe previous
  if (_assignmentChannel) sb.removeChannel(_assignmentChannel);

  _assignmentChannel = sb.channel(`driver-jobs-${driverId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "job_assignments", filter: `driver_id=eq.${driverId}` },
      async () => {
        const assignments = await fetchDriverAssignments(driverId);
        onUpdate(assignments);
      }
    )
    .subscribe();
}

export function unsubscribeJobs() {
  const sb = _getClient();
  if (sb && _assignmentChannel) {
    sb.removeChannel(_assignmentChannel);
    _assignmentChannel = null;
  }
}

// ─── CONFIG CHECK ─────────────────────────────────────────────────────────────

export function isSupabaseConfigured() {
  try {
    const raw = localStorage.getItem(SB_SETTINGS_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    return !!(s && s.url && s.anonKey);
  } catch { return false; }
}
