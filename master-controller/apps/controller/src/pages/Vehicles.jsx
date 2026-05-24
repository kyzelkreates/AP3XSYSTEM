import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { toast } from "../hooks/useToast.js";
import { fmtDate, shortId, statusBadge } from "../lib/fmt.js";

function CreateVehicleModal({ fleets, onClose }) {
  const { dispatch } = useAP3X();
  const [form, setForm] = useState({
    type: "rigid", weightClass: "medium", fuelType: "diesel",
    registration: "", height: "", width: "", fleetId: fleets[0]?.id || ""
  });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!form.fleetId) return;
    setLoading(true);
    try {
      dispatch({
        type: "VEHICLE_CREATE",
        payload: {
          type: form.type,
          weightClass: form.weightClass,
          fuelType: form.fuelType,
          registration: form.registration.trim() || null,
          height: form.height ? parseFloat(form.height) : null,
          width:  form.width  ? parseFloat(form.width)  : null,
          fleetId: form.fleetId,
        }
      });
      toast("Vehicle registered", "success");
      onClose();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Register Vehicle</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="label">Type *</label>
                <select className="select" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                  <option value="rigid">Rigid</option>
                  <option value="artic">Articulated</option>
                  <option value="van">Van</option>
                  <option value="minibus">Minibus</option>
                  <option value="coach">Coach</option>
                  <option value="pickup">Pick-up</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Weight Class *</label>
                <select className="select" value={form.weightClass} onChange={e => setForm(p => ({ ...p, weightClass: e.target.value }))}>
                  <option value="light">Light (&lt;3.5t)</option>
                  <option value="medium">Medium (3.5–12t)</option>
                  <option value="heavy">Heavy (12–26t)</option>
                  <option value="articulated">Articulated (&gt;26t)</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Fuel Type</label>
                <select className="select" value={form.fuelType} onChange={e => setForm(p => ({ ...p, fuelType: e.target.value }))}>
                  <option value="diesel">Diesel</option>
                  <option value="petrol">Petrol</option>
                  <option value="electric">Electric</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="hydrogen">Hydrogen</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Registration</label>
                <input className="input" placeholder="AB12 CDE" value={form.registration}
                  onChange={e => setForm(p => ({ ...p, registration: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Height (m)</label>
                <input className="input" type="number" step="0.1" placeholder="4.2" value={form.height}
                  onChange={e => setForm(p => ({ ...p, height: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Width (m)</label>
                <input className="input" type="number" step="0.1" placeholder="2.55" value={form.width}
                  onChange={e => setForm(p => ({ ...p, width: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Fleet *</label>
              <select className="select" value={form.fleetId} onChange={e => setForm(p => ({ ...p, fleetId: e.target.value }))}>
                {fleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Registering…" : "Register Vehicle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Vehicles({ activeFleet }) {
  const { store } = useAP3X();
  const [showCreate, setShowCreate] = useState(false);
  const fleets   = sel.fleets(store);
  const vehicles = sel.vehicles(store, activeFleet);

  return (
    <div className="main">
      <Topbar
        title="Vehicles"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} disabled={fleets.length === 0}>
            + Register Vehicle
          </button>
        }
      />
      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Registration</th>
                <th>Weight Class</th>
                <th>Fuel</th>
                <th>H × W (m)</th>
                <th>Status</th>
                <th>Fleet</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.length === 0 && (
                <tr><td colSpan={8} className="td-empty">No vehicles registered{activeFleet ? " for this fleet" : ""}.</td></tr>
              )}
              {vehicles.map(v => {
                const fleet = store.fleets[v.fleetId];
                return (
                  <tr key={v.id}>
                    <td><strong>{v.type}</strong></td>
                    <td className="mono">{v.registration || "—"}</td>
                    <td className="text-sm text-muted">{v.weightClass}</td>
                    <td className="text-sm">{v.fuelType}</td>
                    <td className="mono">{v.height ?? "—"} × {v.width ?? "—"}</td>
                    <td><span className={`badge ${statusBadge(v.status)}`}>{v.status}</span></td>
                    <td className="text-sm text-muted">{fleet?.name || shortId(v.fleetId)}</td>
                    <td className="mono">{fmtDate(v.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showCreate && fleets.length > 0 && <CreateVehicleModal fleets={fleets} onClose={() => setShowCreate(false)} />}
    </div>
  );
}
