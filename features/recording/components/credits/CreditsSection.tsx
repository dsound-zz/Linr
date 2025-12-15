import { cn } from "@/lib/utils";
import { surface } from "@styles/typeography";

interface CreditsSectionProps {
  title: React.ReactNode;
  children: React.ReactNode;
}

export default function CreditsSection({
  title,
  children,
}: CreditsSectionProps) {
  return (
    <section className={surface.cardPadded}>
      <div className={cn(surface.headerStrip, "mb-3")}>{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
