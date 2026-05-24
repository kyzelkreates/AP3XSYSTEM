import React from "react";
import { useToastState } from "../../hooks/useToast.js";

export default function ToastContainer() {
  const { toasts } = useToastState();
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}
