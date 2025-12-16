import { useRouter } from "next/router";
import { surface, text } from "@styles/typeography";
import type { Item } from "./viewModel";
import { cn } from "@/lib/utils";

interface CreditListProps {
  items: Item[];
  recordingId?: string;
}

export default function CreditList({ items, recordingId }: CreditListProps) {
  const router = useRouter();

  const handleContributorClick = (name: string) => {
    const params = new URLSearchParams({ name });
    if (recordingId) {
      params.set("from", recordingId);
    }
    router.push(`/contributor/${encodeURIComponent(name)}?${params.toString()}`);
  };

  return (
    <ul className="list-none space-y-2 p-0">
      {items.map((item) => (
        <li
          key={`${item.primary}-${item.secondary ?? ""}`}
          className={cn(
            "flex items-start justify-between gap-3",
            "rounded-xl border border-border/70 bg-background/40",
          )}
        >
          <button
            type="button"
            onClick={() => handleContributorClick(item.primary)}
            className={cn(
              "flex-1 px-3 py-2 text-left",
              text.body,
              "font-medium transition-colors",
              "hover:text-foreground hover:underline",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            {item.primary}
          </button>
          {item.secondary && (
            <span className={cn(surface.badge, "shrink-0 my-2 mr-3")}>
              {item.secondary}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
