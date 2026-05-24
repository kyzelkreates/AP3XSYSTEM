import { useState, useCallback } from "react";

let _globalToast = null;
export function _setGlobalToast(fn) { _globalToast = fn; }

export function toast(msg, type = "info") {
  if (_globalToast) _globalToast(msg, type);
}

export function useToastState() {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((msg, type = "info") => {
    const id = crypto.randomUUID();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);

  _setGlobalToast(add);
  return { toasts };
}
