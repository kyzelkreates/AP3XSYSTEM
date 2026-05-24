import React from "react";
import { useClock } from "../../hooks/useClock.js";

export default function Topbar({ title, actions }) {
  const clock = useClock();
  return (
    <div className="topbar">
      <span className="topbar-title">{title}</span>
      <div className="topbar-right">
        {actions}
        <span className="topbar-clock">{clock}</span>
        <span className="tag">CONTROL PLANE</span>
      </div>
    </div>
  );
}
