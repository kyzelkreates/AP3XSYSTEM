import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { fleetApi } from "../lib/api.js";
import { toast } from "../hooks/useToast.js";
import { fmtDate, shortId } from "../lib/fmt.js";

function CreateFleetModal({ onClose, onCreated }) {
  const { dispatch } = useAP3X();
  const [form, setForm] = useState({ name: "", regulation: "eu_561" });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    try {
      dispatch({ type: "FLEET_CREATE", payload: { name: form.name.trim(), regulation: form.regulation } });
      toast(`Fleet "${form.name}" created`, "success");
      onCreated?.();
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
          <span className="modal-title">Create Fleet</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="label">Fleet Name *</label>
              <input className="input" placeholder="e.g. North Region Fleet" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus />
            </div>
            <div className="form-group">
              <label className="label">Regulation</label>
              <select className="select" value={form.regulation}
                onChange={e => setForm(p => ({ ...p, regulation: e.target.value }))}>
                <option value="eu_561">EU Regulation 561/2006</option>
                <option value="uk_domestic">UK Domestic</option>
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !form.name.trim()}>
              {loading ? "Creating…" : "Create Fleet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Fleets({ activeFleet }) {
  const { store } = useAP3X();
  const [showCreate, setShowCreate] = useState(false);
  const [deploying, setDeploying] = useState(null);
  const fleets = sel.fleets(store);

  async function handleDeploy(fleetId) {
    setDeploying(fleetId);
    try {
      const result = await fleetApi.deploy({ fleetId });
      if (result.success) toast(`Fleet deployed v${result.version || "—"}`, "success");
      else toast(result.errors?.join(", ") || "Deploy failed", "error");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setDeploying(null);
    }
  }

  return (
    <div className="main">
      <Topbar
        title="Fleets"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            + New Fleet
          </button>
        }
      />
      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Regulation</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {fleets.length === 0 && (
                <tr><td colSpan={6} className="td-empty">No fleets. Create your first one.</td></tr>
              )}
              {fleets.map(f => (
                <tr key={f.id}>
                  <td><strong>{f.name}</strong></td>
                  <td className="mono">{shortId(f.id)}</td>
                  <td className="text-muted text-xs">{f.regulation || "eu_561"}</td>
                  <td><span className={`badge badge-${f.status}`}>{f.status}</span></td>
                  <td className="mono">{fmtDate(f.createdAt)}</td>
                  <td>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleDeploy(f.id)}
                      disabled={deploying === f.id}
                    >
                      {deploying === f.id ? "Deploying…" : "🚀 Deploy"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showCreate && <CreateFleetModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
