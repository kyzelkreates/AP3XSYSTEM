import React from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { fmtDate, fmtTime, shortId } from "../lib/fmt.js";

function KPI({ label, val, sub, color = "var(--purple-light)" }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-val" style={{ color }}>{val}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export default function Overview({ activeFleet }) {
  const { store } = useAP3X();
  const fleets   = sel.fleets(store);
  const drivers  = sel.drivers(store, activeFleet);
  const vehicles = sel.vehicles(store, activeFleet);
  const devices  = sel.devices(store, activeFleet);
  const routes   = sel.routes(store, activeFleet);
  const hazards  = sel.hazards(store, activeFleet);
  const events   = store.events.slice(0, 30);

  const onlineDevices  = devices.filter(d => d.status === "bound").length;
  const activeDrivers  = drivers.filter(d => d.status === "active").length;
  const approvedRoutes = routes.filter(r => r.status === "validated" || r.status === "approved").length;
  const activeHazards  = hazards.filter(h => h.status === "active").length;

  return (
    <div className="main">
      <Topbar title="Fleet Overview" />
      <div className="content">

        <div className="grid-kpi">
          <KPI label="Fleets"          val={fleets.length}   sub="total registered" />
          <KPI label="Drivers"         val={drivers.length}  sub={`${activeDrivers} active`} />
          <KPI label="Vehicles"        val={vehicles.length} sub="fleet registered" />
          <KPI label="Devices"         val={devices.length}  sub={`${onlineDevices} bound`} />
          <KPI label="Routes"          val={routes.length}   sub={`${approvedRoutes} approved`} />
          <KPI label="Active Hazards"  val={activeHazards}   sub="live reports" color={activeHazards > 0 ? "var(--amber)" : "var(--green)"} />
        </div>

        {/* Fleet cards */}
        <div className="sec-header">
          <span className="sec-title">Fleets</span>
          <span className="mono">{fleets.length} total</span>
        </div>
        <div className="grid-2" style={{ marginBottom: "1rem" }}>
          {fleets.length === 0 && (
            <div className="card" style={{ gridColumn: "1/-1" }}>
              <div className="empty-state">
                <div className="empty-state-icon">🏢</div>
                <div className="empty-state-text">No fleets. Create one in Fleets.</div>
              </div>
            </div>
          )}
          {fleets.map(f => {
            const fDrivers  = sel.drivers(store, f.id);
            const fVehicles = sel.vehicles(store, f.id);
            const fDevices  = sel.devices(store, f.id);
            const brand = store.fleetBrands[f.id];
            const color = brand?.primaryColor || "var(--purple)";
            return (
              <div key={f.id} className="card" style={{ borderTop: `3px solid ${color}`, marginBottom: 0 }}>
                <div className="flex-between mb-8">
                  <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>{f.name}</span>
                  <span className={`badge badge-${f.status}`}>{f.status}</span>
                </div>
                <div className="mono mb-8">{f.id}</div>
                <div className="flex gap-sm" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  <span>👤 {fDrivers.length}</span>
                  <span>🚚 {fVehicles.length}</span>
                  <span>📱 {fDevices.length}</span>
                </div>
                <div className="text-xs text-muted mt-4">Created {fmtDate(f.createdAt)}</div>
              </div>
            );
          })}
        </div>

        {/* Event stream */}
        <div className="sec-header">
          <span className="sec-title">Recent Events</span>
          <span className="mono">{store.events.length} total</span>
        </div>
        <div className="event-log">
          <div className="event-log-header">
            <span className="text-xs text-muted">EVENT STREAM</span>
            <span className="text-xs" style={{ color: "var(--green)", display:"flex",alignItems:"center",gap:"4px" }}>
              <span className="pulse-dot" style={{marginRight:0}}></span> Live
            </span>
          </div>
          <div className="event-entries">
            {events.length === 0 && <div className="td-empty">No events yet.</div>}
            {events.map(e => (
              <div key={e.id} className="event-entry">
                <span className="ev-time">{fmtTime(e.timestamp)}</span>
                <span className="ev-type">{e.type}</span>
                <span className="ev-ctx">{e.fleetId ? shortId(e.fleetId) : "—"}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
