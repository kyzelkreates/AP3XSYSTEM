import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X } from "../store/ap3x.js";
import { fmtDate, fmtTime, shortId } from "../lib/fmt.js";

const EVENT_FILTERS = [
  { label: "All",        val: "" },
  { label: "Fleet",      val: "fleet." },
  { label: "Driver",     val: "driver." },
  { label: "Vehicle",    val: "vehicle." },
  { label: "Device",     val: "device." },
  { label: "Identity",   val: "identity." },
  { label: "Route",      val: "route." },
  { label: "Hazard",     val: "hazard." },
  { label: "Safety",     val: "route.approved\0route.rejected" },
  { label: "Deployment", val: "deployment." },
  { label: "Sync",       val: "sync." },
];

export default function Events({ activeFleet }) {
  const { store } = useAP3X();
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");

  const allEvents = store.events;

  const filtered = allEvents.filter(e => {
    if (filter) {
      const parts = filter.split("\0");
      if (!parts.some(p => e.type?.startsWith(p))) return false;
    }
    if (activeFleet && e.fleetId && e.fleetId !== activeFleet) return false;
    if (search && !e.type?.includes(search) && !JSON.stringify(e.payload || {}).includes(search)) return false;
    return true;
  });

  return (
    <div className="main">
      <Topbar title="Event Stream" />
      <div className="content">

        {/* Stats */}
        <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
          <div className="kpi">
            <div className="kpi-label">Total</div>
            <div className="kpi-val">{allEvents.length}</div>
          </div>
          {["fleet","driver","vehicle","device","route","hazard"].map(t => (
            <div key={t} className="kpi">
              <div className="kpi-label">{t}</div>
              <div className="kpi-val" style={{ fontSize: "1.3rem" }}>
                {allEvents.filter(e => e.type?.startsWith(t + ".")).length}
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-sm mb-8" style={{ flexWrap: "wrap", marginBottom: "0.75rem" }}>
          {EVENT_FILTERS.map(f => (
            <button key={f.val} onClick={() => setFilter(f.val)}
              className="btn btn-secondary btn-sm"
              style={filter === f.val ? { borderColor: "var(--purple)", color: "var(--purple-light)" } : {}}>
              {f.label}
            </button>
          ))}
          <input
            className="input" style={{ width: 200, fontSize: "0.78rem", padding: "0.3rem 0.65rem" }}
            placeholder="Search events…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Log */}
        <div className="event-log">
          <div className="event-log-header">
            <span className="text-xs text-muted">{filtered.length} events shown</span>
            <span className="text-xs" style={{ color: "var(--green)", display:"flex",alignItems:"center",gap:"4px" }}>
              <span className="pulse-dot" style={{marginRight:0}}></span> Live
            </span>
          </div>
          <div className="event-entries" style={{ maxHeight: "calc(100vh - 320px)" }}>
            {filtered.length === 0 && <div className="td-empty">No events match filter.</div>}
            {filtered.map(e => (
              <div key={e.id} className="event-entry" style={{ gridTemplateColumns: "80px 200px 120px 1fr" }}>
                <span className="ev-time">{fmtTime(e.timestamp)}</span>
                <span className="ev-type">{e.type}</span>
                <span className="mono" style={{ color: "var(--cyan)" }}>{e.fleetId ? shortId(e.fleetId) : "—"}</span>
                <span className="ev-ctx">{e.entityId ? shortId(e.entityId) : JSON.stringify(e.payload || {}).slice(0, 80)}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
