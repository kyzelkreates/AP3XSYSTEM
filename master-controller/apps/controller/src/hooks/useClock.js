import { useState, useEffect } from "react";

export function useClock() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString("en-GB", { hour12: false }));
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB", { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}
