import "../styles/route-sweep.css";

interface RouteSweepProps {
  label: string;
  running: boolean;
  version: number;
}

export function RouteSweep({ label, running, version }: RouteSweepProps) {
  if (!running) return null;

  return (
    <div
      className="dial-archive-route-sweep is-running"
      key={`route-sweep-${version}`}
      role="status"
      aria-live="assertive"
    >
      <span>{label}</span>
    </div>
  );
}
