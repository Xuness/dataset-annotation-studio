import { useEffect, useState } from "react";

function currentClockValue(): string {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function useSystemClock(): string {
  const [clock, setClock] = useState(currentClockValue);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(currentClockValue()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return clock;
}
