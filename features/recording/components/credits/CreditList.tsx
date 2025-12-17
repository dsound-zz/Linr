import { useRouter } from "next/router";
import { surface, text } from "@styles/typeography";
import type { Item } from "./viewModel";
import { cn } from "@/lib/utils";

interface CreditListProps {
  items: Item[];
  songContext?: {
    title: string;
    artist: string;
    recordingId?: string;
  };
  sectionRole?: string; // e.g., "producer", "writer"
}

export default function CreditList({ items, songContext, sectionRole }: CreditListProps) {
  const router = useRouter();

  const handleContributorClick = (item: Item) => {
    const params = new URLSearchParams({ name: item.primary });
    // Pass MBID if available for exact artist matching
    if (item.mbid) {
      params.set("mbid", item.mbid);
    }
    // Pass song context for AI verification
    if (songContext) {
      params.set("from_song", songContext.title);
      params.set("from_artist", songContext.artist);
      if (sectionRole) {
        params.set("from_roles", sectionRole);
      }
      // Pass recording ID so back button can return to original song
      if (songContext.recordingId) {
        params.set("from_recording_id", songContext.recordingId);
      }
    }
    router.push(`/contributor/${encodeURIComponent(item.primary)}?${params.toString()}`);
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
            onClick={() => handleContributorClick(item)}
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
