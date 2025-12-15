import { surface, text } from "@styles/typeography";
import type { Item } from "./viewModel";
import { cn } from "@/lib/utils";

export default function CreditList({ items }: { items: Item[] }) {
  return (
    <ul className="list-none space-y-2 p-0">
      {items.map((item) => (
        <li
          key={`${item.primary}-${item.secondary ?? ""}`}
          className={cn(
            "flex items-start justify-between gap-3",
            "rounded-xl border border-border/70 bg-background/40 px-3 py-2",
          )}
        >
          <span className={cn(text.body, "font-medium")}>{item.primary}</span>
          {item.secondary && (
            <span className={cn(surface.badge, "shrink-0")}>
              {item.secondary}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
