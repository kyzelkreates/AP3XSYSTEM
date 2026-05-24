import React from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { hazardApi } from "../lib/api.js";
import { toast } from "../hooks/useToast.js";
import { fmtDate, shortId, statusBadge } from "../lib/fmt.js";

const HAZARD_ICONS = {
  road_closed:"🚫", road_flooded:"🌊", road_icy:"🧊", pothole:"⚠️", debris:"🪨",
  accident:"💥", congestion:"🚗", roadworks:"🚧", fog:"🌫️", high_wind:"💨",
  flooding:"🌧️", black_ice:"❄️", police_incident:"🚔", other:"❗"
};

export default function Hazards({ activeFleet }) {
  const { store } = useAP3X();
  const hazards = sel.hazards(store, activeFleet);

  const activeCount   = hazards.filter(h => h.status === "active").length;
  const resolvedCount = hazards.filter(h => h.status === "resolved").length;

  return (
    <div className="main">
      <Topbar title="Hazard Reports" />
      <div className="content">

        <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="kpi"><div className="kpi-label">Total</div><div className="kpi-val">{hazards.length}</div></div>
          <div className="kpi"><div className="kpi-label">Active</div><div className="kpi-val" style={{ color: activeCount > 0 ? "var(--amber)" : "var(--green)" }}>{activeCount}</div></div>
          <div className="kpi"><div className="kpi-label">Resolved</div><div className="kpi-val" style={{ color: "var(--green)" }}>{resolvedCount}</div></div>
          <div className="kpi"><div className="kpi-label">Confirmed</div><div className="kpi-val">{hazards.filter(h=>h.confirmations>0).length}</div></div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Severity</th>
                <th>Location</th>
                <th>Status</th>
                <th>Confirmed</th>
                <th>Disputed</th>
                <th>Reported By</th>
                <th>Expires</th>
                <th>Reported</th>
              </tr>
            </thead>
            <tbody>
              {hazards.length === 0 && (
                <tr><td colSpan={9} className="td-empty">No hazard reports{activeFleet ? " for this fleet" : ""}.</td></tr>
              )}
              {hazards.map(h => {
                const driver = store.drivers[h.reportedByDriverId];
                return (
                  <tr key={h.id}>
                    <td>
                      <span style={{ marginRight: 6 }}>{HAZARD_ICONS[h.type] || "❗"}</span>
                      <span className="text-sm">{h.type?.replace(/_/g, " ")}</span>
                    </td>
                    <td>
                      <span className={`badge badge-${h.severity === "critical" ? "failed" : h.severity === "high" ? "unbound" : "pending"}`}>
                        {h.severity}
                      </span>
                    </td>
                    <td className="mono">{h.lat?.toFixed(4)}, {h.lon?.toFixed(4)}</td>
                    <td><span className={`badge ${statusBadge(h.status)}`}>{h.status}</span></td>
                    <td className="mono">{h.confirmations ?? 0}</td>
                    <td className="mono">{h.rejections ?? 0}</td>
                    <td className="text-sm">{driver?.name || shortId(h.reportedByDriverId)}</td>
                    <td className="mono text-xs">{h.expiresAt ? fmtDate(h.expiresAt) : "—"}</td>
                    <td className="mono">{fmtDate(h.reportedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
