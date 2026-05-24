import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { safetyApi } from "../lib/api.js";
import { toast } from "../hooks/useToast.js";
import { fmtDate, shortId, statusBadge } from "../lib/fmt.js";

function CreateRouteModal({ store, fleets, onClose }) {
  const { dispatch } = useAP3X();
  const [form, setForm] = useState({
    fleetId: fleets[0]?.id || "",
    vehicleId: "",
    driverId: "",
    drops: [{ lat: "", lon: "", label: "", sequence: 1 }],
  });
  const [loading, setLoading] = useState(false);

  const fleetVehicles = Object.values(store.vehicles).filter(v => v.fleetId === form.fleetId && v.status === "active");
  const fleetDrivers  = Object.values(store.drivers).filter(d => d.fleetId === form.fleetId && d.identityId);

  function addDrop() {
    setForm(p => ({ ...p, drops: [...p.drops, { lat: "", lon: "", label: "", sequence: p.drops.length + 1 }] }));
  }
  function removeDrop(i) {
    setForm(p => ({ ...p, drops: p.drops.filter((_, idx) => idx !== i).map((d, idx) => ({ ...d, sequence: idx + 1 })) }));
  }
  function updateDrop(i, field, val) {
    setForm(p => {
      const drops = [...p.drops];
      drops[i] = { ...drops[i], [field]: val };
      return { ...p, drops };
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.fleetId || !form.vehicleId) return;
    const validDrops = form.drops.filter(d => d.lat && d.lon);
    if (validDrops.length < 1) { toast("Add at least one drop with coordinates", "error"); return; }

    setLoading(true);
    try {
      // Build route object locally (mirrors server route-engine output)
      const routeId = crypto.randomUUID();
      const drops = validDrops.map((d, i) => ({
        lat: parseFloat(d.lat), lon: parseFloat(d.lon), label: d.label || `Stop ${i+1}`, sequence: d.sequence
      }));

      // Estimate via haversine
      let totalKm = 0;
      for (let i = 0; i < drops.length - 1; i++) {
        totalKm += _haversine(drops[i].lat, drops[i].lon, drops[i+1].lat, drops[i+1].lon) * 1.15;
      }
      const durationMin = totalKm / 48 * 60;

      const route = {
        id: routeId,
        fleetId: form.fleetId,
        vehicleId: form.vehicleId,
        driverId: form.driverId || null,
        drops,
        status: "validated",
        provider: "local_estimate",
        summary: { distanceKm: parseFloat(totalKm.toFixed(2)), durationMin: parseFloat(durationMin.toFixed(1)) },
        createdAt: Date.now(),
      };

      dispatch({ type: "ROUTE_ADD", payload: route });
      toast(`Route created — ${totalKm.toFixed(1)} km`, "success");
      onClose();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Generate Route</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="label">Fleet *</label>
              <select className="select" value={form.fleetId} onChange={e => setForm(p => ({ ...p, fleetId: e.target.value, vehicleId: "", driverId: "" }))}>
                {fleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Vehicle *</label>
                <select className="select" value={form.vehicleId} onChange={e => setForm(p => ({ ...p, vehicleId: e.target.value }))}>
                  <option value="">Select…</option>
                  {fleetVehicles.map(v => <option key={v.id} value={v.id}>{v.type} · {v.registration || shortId(v.id)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Driver (bound)</label>
                <select className="select" value={form.driverId} onChange={e => setForm(p => ({ ...p, driverId: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {fleetDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            <hr className="divider" />
            <div className="sec-header mb-8">
              <span className="sec-title">Drop Points</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addDrop}>+ Add Drop</button>
            </div>

            {form.drops.map((drop, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0.4rem", marginBottom: "0.5rem", alignItems:"end" }}>
                <div>
                  {i === 0 && <div className="label">Latitude</div>}
                  <input className="input" placeholder="51.5074" value={drop.lat} onChange={e => updateDrop(i, "lat", e.target.value)} />
                </div>
                <div>
                  {i === 0 && <div className="label">Longitude</div>}
                  <input className="input" placeholder="-0.1278" value={drop.lon} onChange={e => updateDrop(i, "lon", e.target.value)} />
                </div>
                <div>
                  {i === 0 && <div className="label">Label</div>}
                  <input className="input" placeholder={`Stop ${i + 1}`} value={drop.label} onChange={e => updateDrop(i, "label", e.target.value)} />
                </div>
                <button type="button" className="btn btn-danger btn-sm" style={{ marginBottom: 0 }} onClick={() => removeDrop(i)} disabled={form.drops.length === 1}>✕</button>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !form.vehicleId}>
              {loading ? "Generating…" : "Generate Route"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function _haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dG/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default function Routes({ activeFleet }) {
  const { store } = useAP3X();
  const [showCreate, setShowCreate] = useState(false);
  const [evaluating, setEvaluating] = useState(null);
  const fleets = sel.fleets(store);
  const routes = sel.routes(store, activeFleet);

  async function handleSafetyEval(routeId) {
    setEvaluating(routeId);
    try {
      const result = await safetyApi.evaluate(routeId, "master_controller");
      toast(`Safety: ${result.decision?.approved ? "✅ Approved" : "❌ Rejected"} (score ${result.decision?.riskScore ?? "—"}/100)`,
        result.decision?.approved ? "success" : "error");
    } catch (err) {
      toast("Safety eval: " + err.message, "error");
    } finally {
      setEvaluating(null);
    }
  }

  return (
    <div className="main">
      <Topbar
        title="Routes"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} disabled={fleets.length === 0}>
            + Generate Route
          </button>
        }
      />
      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Route ID</th>
                <th>Vehicle</th>
                <th>Driver</th>
                <th>Drops</th>
                <th>Distance</th>
                <th>Status</th>
                <th>Provider</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.length === 0 && (
                <tr><td colSpan={9} className="td-empty">No routes. Generate one above.</td></tr>
              )}
              {routes.map(r => {
                const vehicle = store.vehicles[r.vehicleId];
                const driver  = store.drivers[r.driverId];
                return (
                  <tr key={r.id}>
                    <td className="mono">{shortId(r.id)}</td>
                    <td className="text-sm">{vehicle?.registration || vehicle?.type || shortId(r.vehicleId)}</td>
                    <td className="text-sm">{driver?.name || <span className="text-muted">—</span>}</td>
                    <td className="mono">{r.drops?.length ?? "—"}</td>
                    <td className="mono">{r.summary?.distanceKm ?? "—"} km</td>
                    <td><span className={`badge ${statusBadge(r.status)}`}>{r.status}</span></td>
                    <td className="text-xs text-muted">{r.provider || "—"}</td>
                    <td className="mono">{fmtDate(r.createdAt)}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm"
                        onClick={() => handleSafetyEval(r.id)}
                        disabled={evaluating === r.id}>
                        {evaluating === r.id ? "…" : "🛡️ Safety"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showCreate && fleets.length > 0 && <CreateRouteModal store={store} fleets={fleets} onClose={() => setShowCreate(false)} />}
    </div>
  );
}
