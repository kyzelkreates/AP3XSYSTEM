import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { toast } from "../hooks/useToast.js";
import { fmtDate, shortId, statusBadge } from "../lib/fmt.js";

function RegisterDeviceModal({ fleets, onClose }) {
  const { dispatch } = useAP3X();
  const [form, setForm] = useState({ platform: "android", ap3xVersion: "1.0.0", hardwareId: "", fleetId: fleets[0]?.id || "" });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!form.fleetId) return;
    setLoading(true);
    try {
      dispatch({
        type: "DEVICE_REGISTER",
        payload: {
          platform: form.platform,
          ap3xVersion: form.ap3xVersion,
          hardwareId: form.hardwareId.trim() || null,
          fleetId: form.fleetId,
        }
      });
      toast("Device registered", "success");
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
          <span className="modal-title">Register AP3X Device</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="label">Platform *</label>
                <select className="select" value={form.platform} onChange={e => setForm(p => ({ ...p, platform: e.target.value }))}>
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                  <option value="linux">Linux</option>
                  <option value="embedded">Embedded</option>
                  <option value="web">Web</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">AP3X Version</label>
                <input className="input" placeholder="1.0.0" value={form.ap3xVersion}
                  onChange={e => setForm(p => ({ ...p, ap3xVersion: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Hardware ID / IMEI</label>
              <input className="input" placeholder="Optional serial number" value={form.hardwareId}
                onChange={e => setForm(p => ({ ...p, hardwareId: e.target.value }))} />
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
              {loading ? "Registering…" : "Register Device"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Devices({ activeFleet }) {
  const { store } = useAP3X();
  const [showCreate, setShowCreate] = useState(false);
  const fleets  = sel.fleets(store);
  const devices = sel.devices(store, activeFleet);

  function driverName(id) {
    return store.drivers[id]?.name || shortId(id);
  }

  return (
    <div className="main">
      <Topbar
        title="Devices"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)} disabled={fleets.length === 0}>
            + Register Device
          </button>
        }
      />
      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device ID</th>
                <th>Platform</th>
                <th>AP3X Ver.</th>
                <th>Status</th>
                <th>Bound Driver</th>
                <th>Fleet</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && (
                <tr><td colSpan={7} className="td-empty">No devices registered.</td></tr>
              )}
              {devices.map(d => {
                const fleet = store.fleets[d.fleetId];
                return (
                  <tr key={d.id}>
                    <td className="mono">{shortId(d.id)}</td>
                    <td className="text-sm">{d.platform}</td>
                    <td className="mono">v{d.ap3xVersion}</td>
                    <td><span className={`badge ${statusBadge(d.status)}`}>{d.status}</span></td>
                    <td className="text-sm">{d.boundDriverId ? driverName(d.boundDriverId) : <span className="text-muted">—</span>}</td>
                    <td className="text-sm text-muted">{fleet?.name || shortId(d.fleetId)}</td>
                    <td className="mono">{fmtDate(d.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showCreate && fleets.length > 0 && <RegisterDeviceModal fleets={fleets} onClose={() => setShowCreate(false)} />}
    </div>
  );
}
