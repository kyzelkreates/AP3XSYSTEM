import React, { useState } from "react";
import Topbar from "../components/layout/Topbar.jsx";
import { useAP3X } from "../store/ap3x.js";
import { fmtDate, fmtTime, shortId } from "../lib/fmt.js";

export default function Audit({ activeFleet }) {
  const { store } = useAP3X();
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const events = activeFleet
    ? store.events.filter(e => !e.fleetId || e.fleetId === activeFleet)
    : store.events;

  const total = events.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const slice = events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="main">
      <Topbar title="Audit Log" />
      <div className="content">
        <div className="flex-between mb-8" style={{ marginBottom: "0.75rem" }}>
          <span className="text-muted text-sm">{total} total events</span>
          <div className="flex gap-sm">
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>← Prev</button>
            <span className="text-sm text-muted" style={{ padding: "0.3rem 0.4rem" }}>{page} / {pages}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.min(pages, p+1))} disabled={page === pages}>Next →</button>
          </div>
        </div>
        <div className="event-log">
          <div className="event-entries" style={{ maxHeight: "calc(100vh - 260px)", fontFamily: "monospace", fontSize: "0.73rem" }}>
            {slice.length === 0 && <div className="td-empty">No audit entries.</div>}
            {slice.map(e => (
              <div key={e.id} style={{
                display: "grid", gridTemplateColumns: "80px 45px 200px 130px 1fr",
                gap: "0.5rem", padding: "0.38rem 0.85rem",
                borderBottom: "1px solid var(--border)"
              }}>
                <span style={{ color: "var(--muted)" }}>{fmtTime(e.timestamp)}</span>
                <span style={{ color: "var(--muted)", fontSize: "0.65rem" }}>{new Date(e.timestamp).toLocaleDateString("en-GB", { day:"2-digit", month:"short" })}</span>
                <span style={{ color: "var(--purple-light)", fontWeight: 700 }}>{e.type}</span>
                <span style={{ color: "var(--cyan)", fontFamily:"monospace" }}>{e.fleetId ? shortId(e.fleetId) : "—"}</span>
                <span style={{ color: "var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {e.entityId ? `entity:${shortId(e.entityId)}` : JSON.stringify(e.payload || {}).slice(0, 80)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
