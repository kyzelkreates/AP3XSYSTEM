// Shared formatters

export function shortId(id) {
  return id ? id.slice(0, 8) : "—";
}

export function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

export function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}

export function fmtDuration(ms) {
  if (!ms) return "0s";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function statusBadge(status) {
  const map = {
    active:      "badge-active",
    bound:       "badge-bound",
    unbound:     "badge-unbound",
    revoked:     "badge-revoked",
    deploying:   "badge-deploying",
    failed:      "badge-failed",
    approved:    "badge-approved",
    rejected:    "badge-rejected",
    pending:     "badge-pending",
    computed:    "badge-deploying",
    validated:   "badge-approved",
    cancelled:   "badge-revoked",
    deregistered:"badge-revoked",
    inactive:    "badge-revoked",
    resolved:    "badge-active",
  };
  return map[status] || "badge-pending";
}
