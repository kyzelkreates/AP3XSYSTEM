import React from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { fmtDate, shortId } from "../lib/fmt.js";

export default function Safety({ activeFleet }) {
  const { store } = useAP3X();
  const decisions = sel.safetyDecisions(store, activeFleet);
  const routes    = sel.routes(store, activeFleet);

  const approved = decisions.filter(d => d.approved).length;
  const rejected = decisions.filter(d => !d.approved).length;

  return (
    <div className="main">
      <Topbar title="Safety AI Gatekeeper" />
      <div className="content">

        <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="kpi"><div className="kpi-label">Decisions</div><div className="kpi-val">{decisions.length}</div></div>
          <div className="kpi"><div className="kpi-label">Approved</div><div className="kpi-val" style={{ color: "var(--green)" }}>{approved}</div></div>
          <div className="kpi"><div className="kpi-label">Rejected</div><div className="kpi-val" style={{ color: "var(--red)" }}>{rejected}</div></div>
          <div className="kpi"><div className="kpi-label">Routes</div><div className="kpi-val">{routes.length}</div></div>
        </div>

        <div className="card" style={{ background: "var(--amber-bg)", border: "1px solid var(--amber)", marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--amber)" }}>
            🛡️ <strong>Safety AI Rule:</strong> AI may recommend — it may not override. All decisions are deterministic rule-based.
            Driver PWA cannot modify approved routes. All hazard data is event-logged.
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Decision ID</th>
                <th>Route</th>
                <th>Outcome</th>
                <th>Risk Score</th>
                <th>Risk Level</th>
                <th>Blockers</th>
                <th>Evaluated</th>
              </tr>
            </thead>
            <tbody>
              {decisions.length === 0 && (
                <tr><td colSpan={7} className="td-empty">No safety evaluations. Run safety check on a route in Routes view.</td></tr>
              )}
              {decisions.map(d => (
                <tr key={d.id}>
                  <td className="mono">{shortId(d.id)}</td>
                  <td className="mono">{shortId(d.routeId)}</td>
                  <td>
                    <span className={`badge badge-${d.approved ? "approved" : "rejected"}`}>
                      {d.approved ? "✅ Approved" : "❌ Rejected"}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ color: d.riskScore > 70 ? "var(--red)" : d.riskScore > 40 ? "var(--amber)" : "var(--green)" }}>
                      {d.riskScore ?? "—"}/100
                    </span>
                  </td>
                  <td className="text-sm text-muted">{d.riskLevel || "—"}</td>
                  <td className="text-xs text-red">{d.blockers?.join(", ") || "—"}</td>
                  <td className="mono">{fmtDate(d.evaluatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
