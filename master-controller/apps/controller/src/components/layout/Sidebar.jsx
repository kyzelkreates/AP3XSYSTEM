import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAP3X, sel } from "../../store/ap3x.js";

const NAV = [
  { section: "Control Plane" },
  { to: "/",           icon: "◈",  label: "Overview"    },
  { to: "/fleets",     icon: "🏢", label: "Fleets"      },
  { to: "/deploy",     icon: "🚀", label: "Deployments" },
  { section: "Entities" },
  { to: "/drivers",    icon: "👤", label: "Drivers"     },
  { to: "/vehicles",   icon: "🚚", label: "Vehicles"    },
  { to: "/devices",    icon: "📱", label: "Devices"     },
  { to: "/identities", icon: "🔗", label: "Identities"  },
  { section: "Operations" },
  { to: "/routes",     icon: "🗺️",  label: "Routes"      },
  { to: "/hazards",    icon: "⚠️",  label: "Hazards"     },
  { to: "/safety",     icon: "🛡️",  label: "Safety AI"   },
  { section: "Observability" },
  { to: "/events",     icon: "📡", label: "Event Stream"},
  { to: "/audit",      icon: "📊", label: "Audit Log"   },
];

export default function Sidebar({ activeFleet, onFleetChange }) {
  const { store } = useAP3X();
  const fleets = sel.fleets(store);

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">⬡</div>
        <div>
          <div className="logo-name">AP3X</div>
          <div className="logo-sub">MASTER CONTROLLER</div>
        </div>
      </div>

      {/* Fleet selector */}
      <div style={{ padding: "0.65rem 0.85rem", borderBottom: "1px solid var(--border)" }}>
        <div className="label" style={{ marginBottom: "0.35rem" }}>Active Fleet</div>
        <select
          className="select"
          value={activeFleet}
          onChange={e => onFleetChange(e.target.value)}
          style={{ fontSize: "0.78rem", padding: "0.38rem 0.6rem" }}
        >
          <option value="">— All Fleets —</option>
          {fleets.map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      <div className="sidebar-nav">
        {NAV.map((item, i) =>
          item.section ? (
            <div key={i} className="nav-section">{item.section}</div>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          )
        )}
      </div>

      <div className="sidebar-footer">
        <span className="pulse-dot"></span>
        Control Plane · Read/Write
      </div>
    </nav>
  );
}
