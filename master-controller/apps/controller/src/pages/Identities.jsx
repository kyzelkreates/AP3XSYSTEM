import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X, sel } from "../store/ap3x.js";
import { toast } from "../hooks/useToast.js";
import { fmtDate, shortId } from "../lib/fmt.js";

function BindModal({ store, fleets, onClose }) {
  const { dispatch } = useAP3X();
  const [form, setForm] = useState({ fleetId: fleets[0]?.id || "", driverId: "", deviceId: "" });
  const [loading, setLoading] = useState(false);

  const fleetDrivers = Object.values(store.drivers).filter(d => d.fleetId === form.fleetId && !d.identityId);
  const fleetDevices = Object.values(store.devices).filter(d => d.fleetId === form.fleetId && d.status === "unbound");

  async function submit(e) {
    e.preventDefault();
    if (!form.fleetId || !form.driverId || !form.deviceId) return;
    // Guard: validate both belong to the same fleet
    const driver = store.drivers[form.driverId];
    const device = store.devices[form.deviceId];
    if (!driver || driver.fleetId !== form.fleetId) { toast("Driver not in fleet", "error"); return; }
    if (!device || device.fleetId !== form.fleetId) { toast("Device not in fleet", "error"); return; }
    if (driver.identityId) { toast("Driver already bound", "error"); return; }
    if (device.status === "bound") { toast("Device already bound", "error"); return; }

    setLoading(true);
    try {
      dispatch({ type: "IDENTITY_BIND", payload: { fleetId: form.fleetId, driverId: form.driverId, deviceId: form.deviceId } });
      toast(`Driver ↔ Device bound`, "success");
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
          <span className="modal-title">Bind Driver ↔ Device</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="label">Fleet *</label>
              <select className="select" value={form.fleetId} onChange={e => setForm(p => ({ ...p, fleetId: e.target.value, driverId: "", deviceId: "" }))}>
                {fleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Driver (unbound) *</label>
                <select className="select" value={form.driverId} onChange={e => setForm(p => ({ ...p, driverId: e.target.value }))}>
                  <option value="">Select…</option>
                  {fleetDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {fleetDrivers.length === 0 && <div className="error-msg">No unbound drivers in this fleet</div>}
              </div>
              <div className="form-group">
                <label className="label">Device (unbound) *</label>
                <select className="select" value={form.deviceId} onChange={e => setForm(p => ({ ...p, deviceId: e.target.value }))}>
                  <option value="">Select…</option>
                  {fleetDevices.map(d => <option key={d.id} value={d.id}>{d.platform} · {shortId(d.id)}</option>)}
                </select>
                {fleetDevices.length === 0 && <div className="error-msg">No unbound devices in this fleet</div>}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !form.driverId || !form.deviceId}>
              {loading ? "Binding…" : "Bind Identity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Identities({ activeFleet }) {
  const { store, dispatch } = useAP3X();
  const [showBind, setShowBind] = useState(false);
  const fleets     = sel.fleets(store);
  const identities = sel.identities(store, activeFleet);

  function handleUnbind(identityId) {
    if (!confirm("Revoke this identity binding?")) return;
    dispatch({ type: "IDENTITY_UNBIND", payload: { identityId } });
    toast("Identity revoked", "info");
  }

  return (
    <div className="main">
      <Topbar
        title="Identity Links"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setShowBind(true)} disabled={fleets.length === 0}>
            + Bind Driver ↔ Device
          </button>
        }
      />
      <div className="content">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Device</th>
                <th>Fleet</th>
                <th>Status</th>
                <th>Bound</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {identities.length === 0 && (
                <tr><td colSpan={6} className="td-empty">No identity bindings. Bind a driver to a device.</td></tr>
              )}
              {identities.map(i => {
                const driver = store.drivers[i.driverId];
                const device = store.devices[i.deviceId];
                const fleet  = store.fleets[i.fleetId];
                return (
                  <tr key={i.id}>
                    <td>
                      <div className="font-bold text-sm">{driver?.name || shortId(i.driverId)}</div>
                      <div className="mono">{driver?.licenseType}</div>
                    </td>
                    <td>
                      <div className="text-sm">{device?.platform || shortId(i.deviceId)}</div>
                      <div className="mono">v{device?.ap3xVersion}</div>
                    </td>
                    <td className="text-sm text-muted">{fleet?.name || shortId(i.fleetId)}</td>
                    <td><span className={`badge badge-${i.status === "active" ? "bound" : "revoked"}`}>{i.status}</span></td>
                    <td className="mono">{fmtDate(i.createdAt)}</td>
                    <td>
                      {i.status === "active" && (
                        <button className="btn btn-danger btn-sm" onClick={() => handleUnbind(i.id)}>Revoke</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showBind && fleets.length > 0 && <BindModal store={store} fleets={fleets} onClose={() => setShowBind(false)} />}
    </div>
  );
}
