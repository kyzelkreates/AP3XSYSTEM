import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { fleetApi } from "../lib/api.js";
import { toast } from "../hooks/useToast.js";
import { fmtDate, shortId, statusBadge } from "../lib/fmt.js";

export default function Deploy({ activeFleet }) {
  const { store, dispatch } = useAP3X();
  const [deploying, setDeploying] = useState(null);
  const fleets      = sel.fleets(store);
  const deployments = sel.deployments(store, activeFleet);

  async function handleDeploy(fleetId) {
    const fleet = store.fleets[fleetId];
    if (!fleet) return;

    // Pre-flight checks client-side
    const drivers  = sel.drivers(store, fleetId);
    const vehicles = sel.vehicles(store, fleetId);
    const devices  = sel.devices(store, fleetId);
    const bound    = sel.identities(store, fleetId).filter(i => i.status === "active");

    if (vehicles.length === 0) { toast("Pre-flight fail: No vehicles registered", "error"); return; }
    if (drivers.length === 0)  { toast("Pre-flight fail: No drivers registered", "error"); return; }

    setDeploying(fleetId);
    try {
      // Call the real API
      const result = await fleetApi.deploy({ fleetId });
      if (result.success) {
        dispatch({ type: "DEPLOYMENT_ADD", payload: { fleetId, version: result.version, status: "deployed", bundleId: result.bundleId } });
        toast(`✅ Fleet "${fleet.name}" deployed v${result.version || "—"}`, "success");
      } else {
        dispatch({ type: "DEPLOYMENT_ADD", payload: { fleetId, status: "failed", errors: result.errors } });
        toast(`Deploy failed: ${(result.errors || [result.error]).join(", ")}`, "error");
      }
    } catch (err) {
      // If API is offline (dev mode), still record locally
      dispatch({ type: "DEPLOYMENT_ADD", payload: { fleetId, status: "local_only", note: "API unavailable — recorded locally" } });
      toast(`API unavailable — deployment recorded locally`, "info");
    } finally {
      setDeploying(null);
    }
  }

  return (
    <div className="main">
      <Topbar title="Deployments" />
      <div className="content">

        {/* Deploy per fleet */}
        <div className="sec-header">
          <span className="sec-title">Deploy Fleet</span>
        </div>
        <div className="grid-2" style={{ marginBottom: "1.25rem" }}>
          {fleets.length === 0 && (
            <div className="card" style={{ gridColumn: "1/-1" }}>
              <div className="empty-state">
                <div className="empty-state-icon">🚀</div>
                <div className="empty-state-text">Create a fleet first before deploying.</div>
              </div>
            </div>
          )}
          {fleets.map(f => {
            const fDrivers  = sel.drivers(store, f.id);
            const fVehicles = sel.vehicles(store, f.id);
            const fDevices  = sel.devices(store, f.id);
            const bound     = sel.identities(store, f.id).filter(i => i.status === "active");
            const lastDep   = sel.deployments(store, f.id).sort((a,b) => b.createdAt - a.createdAt)[0];
            const ready     = fDrivers.length > 0 && fVehicles.length > 0;
            return (
              <div key={f.id} className="card" style={{ marginBottom: 0 }}>
                <div className="flex-between mb-8">
                  <span className="font-bold">{f.name}</span>
                  <span className={`badge badge-${f.status}`}>{f.status}</span>
                </div>
                <div className="grid-2" style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
                  <span>👤 {fDrivers.length} drivers</span>
                  <span>🚚 {fVehicles.length} vehicles</span>
                  <span>📱 {fDevices.length} devices</span>
                  <span>🔗 {bound.length} identities</span>
                </div>
                {!ready && (
                  <div className="text-xs" style={{ color: "var(--amber)", marginBottom: "0.5rem" }}>
                    ⚠️ Pre-flight: add {fDrivers.length === 0 ? "drivers" : ""}{fVehicles.length === 0 ? " + vehicles" : ""}
                  </div>
                )}
                {lastDep && (
                  <div className="text-xs text-muted mb-8">Last: {lastDep.status} · {fmtDate(lastDep.createdAt)}</div>
                )}
                <button
                  className="btn btn-primary btn-full"
                  onClick={() => handleDeploy(f.id)}
                  disabled={deploying === f.id}
                >
                  {deploying === f.id ? "Deploying…" : "🚀 Deploy"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Deployment history */}
        <div className="sec-header">
          <span className="sec-title">Deployment History</span>
          <span className="mono">{deployments.length} records</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Fleet</th><th>Version</th><th>Status</th><th>Deployed</th></tr>
            </thead>
            <tbody>
              {deployments.length === 0 && (
                <tr><td colSpan={5} className="td-empty">No deployments yet.</td></tr>
              )}
              {[...deployments].sort((a,b) => b.createdAt - a.createdAt).map(d => {
                const fleet = store.fleets[d.fleetId];
                return (
                  <tr key={d.id}>
                    <td className="mono">{shortId(d.id)}</td>
                    <td className="text-sm">{fleet?.name || shortId(d.fleetId)}</td>
                    <td className="mono">{d.version || "—"}</td>
                    <td><span className={`badge ${statusBadge(d.status)}`}>{d.status}</span></td>
                    <td className="mono">{fmtDate(d.createdAt)}</td>
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
