import { cn } from "@/lib/utils";

export function RecordSpinner({
  size = 28,
  className,
  label = "LINR",
  showTonearm = false,
}: {
  size?: number;
  className?: string;
  label?: string;
  showTonearm?: boolean;
}) {
  const px = `${size}px`;

  return (
    <div
      className={cn("relative inline-block", className)}
      style={{ width: px, height: px }}
      aria-label="Loading"
      role="status"
    >
      <style jsx global>{`
        @keyframes linr-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      <div
        className={cn(
          "absolute inset-0 rounded-full border-2 border-border bg-card",
        )}
        style={{ animation: "linr-spin 1.1s linear infinite" }}
      >
        {/* A small highlight dot so rotation is visually obvious */}
        <div className="absolute left-1/2 top-[10%] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary" />
        <div className="absolute inset-[16%] rounded-full border-2 border-border" />
        <div className="absolute inset-[30%] rounded-full border-2 border-border" />
        <div className="absolute inset-[44%] rounded-full bg-accent" />
        <div className="absolute inset-[58%] rounded-full border border-border bg-card" />
      </div>

      {showTonearm ? (
        <div className="pointer-events-none absolute -right-1 top-1 h-1 w-[55%] origin-left rotate-12 rounded-full bg-primary shadow-sm" />
      ) : null}

      <div className="absolute inset-0 grid place-items-center">
        <div className="rounded-full bg-accent px-1 text-[9px] font-semibold tracking-wide text-accent-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}
