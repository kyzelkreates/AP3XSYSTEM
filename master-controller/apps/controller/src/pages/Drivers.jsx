import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { toast } from "../hooks/useToast.js";
import { fmtDate, shortId, statusBadge } from "../lib/fmt.js";

function CreateDriverModal({ fleets, onClose }) {
  const { dispatch } = useAP3X();
  const [form, setForm] = useState({ name: "", licenseType: "C", fleetId: fleets[0]?.id || "" });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.fleetId) return;
    setLoading(true);
    try {
      dispatch({ type: "DRIVER_CREATE", payload: { name: form.name.trim(), licenseType: form.licenseType, fleetId: form.fleetId } });
      toast(`Driver "${form.name}" registered`, "success");
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
          <span className="modal-title">Register Driver</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="label">Driver Name *</label>
              <input className="input" placeholder="Full name" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Licence Class *</label>
                <select className="select" value={form.licenseType}
                  onChange={e => setForm(p => ({ ...p, licenseType: e.target.value }))}>
                  <option value="B">B — Car</option>
                  <option value="C1">C1 — Medium Goods</option>
                  <option value="C">C — Large Goods</option>
                  <option value="CE">CE — Artic + Trailer</option>
                  <option value="D">D — Bus</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Fleet *</label>
                <select className="select" value={form.fleetId}
                  onChange={e => setForm(p => ({ ...p, fleetId: e.target.value }))}>
                  {fleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !form.name.trim() || !form.fleetId}>
              {loading ? "Registering…" : "Register Driver"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Drivers({ activeFleet }) {
  const { store } = useAP3X();
  const [showCreate, setShowCreate] = useState(false);
  const fleets  = sel.fleets(store);
  const drivers = sel.drivers(store, activeFleet);

  return (
    <div className="main">
      <Topbar
        title="Drivers"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} disabled={fleets.length === 0}>
            + Register Driver
          </button>
        }
      />
      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Licence</th>
                <th>Status</th>
                <th>Identity</th>
                <th>Bound Device</th>
                <th>Fleet</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 && (
                <tr><td colSpan={7} className="td-empty">No drivers registered{activeFleet ? " for this fleet" : ""}.</td></tr>
              )}
              {drivers.map(d => {
                const fleet = store.fleets[d.fleetId];
                return (
                  <tr key={d.id}>
                    <td><strong>{d.name}</strong></td>
                    <td><span className="tag">{d.licenseType}</span></td>
                    <td><span className={`badge ${statusBadge(d.status)}`}>{d.status}</span></td>
                    <td>
                      {d.identityId
                        ? <span className="badge badge-bound">Linked</span>
                        : <span className="badge badge-unbound">Unlinked</span>}
                    </td>
                    <td className="mono">{d.boundDeviceId ? shortId(d.boundDeviceId) : "—"}</td>
                    <td className="text-muted text-sm">{fleet?.name || shortId(d.fleetId)}</td>
                    <td className="mono">{fmtDate(d.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showCreate && fleets.length > 0 && <CreateDriverModal fleets={fleets} onClose={() => setShowCreate(false)} />}
    </div>
  );
}
