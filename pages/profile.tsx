import * as React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Star, UserCircle } from "lucide-react";

import { AppLayout } from "@components/layout/app-layout";
import { Button } from "@components/ui/button";
import { cn } from "@/lib/utils";
import { useFavorites } from "@/hooks/useFavorites";
import { surface, text } from "@styles/typeography";

type ProfileUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type ProfileUserUpdate = Partial<ProfileUser> & { id: string };

function mergeProfileUser(
  prev: ProfileUser | null,
  next: ProfileUserUpdate,
): ProfileUser {
  return {
    id: next.id,
    name: next.name ?? prev?.name ?? null,
    email: next.email ?? prev?.email ?? null,
    image: next.image ?? prev?.image ?? null,
  };
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const { favorites, isLoading, removeFavorite } = useFavorites();
  const [user, setUser] = React.useState<ProfileUser | null>(null);
  const [name, setName] = React.useState("");
  const [image, setImage] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) throw new Error("Failed to load profile");
        const json = (await res.json()) as { user?: ProfileUser };
        if (cancelled) return;
        if (json.user) {
          setUser(json.user);
          setName(json.user.name ?? "");
          setImage(json.user.image ?? "");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load profile");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || null, image: image.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to save profile");
      const json = (await res.json()) as { user?: ProfileUserUpdate };
      const updatedUser = json.user;
      if (updatedUser) {
        setUser((prev) => mergeProfileUser(prev, updatedUser));
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return (
      <AppLayout>
        <div className={cn(surface.cardPadded, "text-sm text-muted-foreground")}>
          Loading profile…
        </div>
      </AppLayout>
    );
  }

  if (!session?.user?.id) {
    return (
      <AppLayout>
        <div className={cn(surface.cardPadded, "space-y-4")}>
          <div className={text.sectionTitle}>Profile</div>
          <div className={text.meta}>Sign in to manage your profile.</div>
          <Button asChild>
            <Link href="/api/auth/signin">Sign in</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <section className={cn(surface.cardPadded, "space-y-4")}>
          <div className={text.sectionTitle}>Profile</div>
          <div className="flex items-start gap-4">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={name || "Profile image"}
                className="h-16 w-16 rounded-full border border-border object-cover"
                width={64}
                height={64}
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-secondary/40">
                <UserCircle className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div className="space-y-2">
              <div className={text.meta}>{user?.email}</div>
              <div className="space-y-1">
                <label className={text.meta}>Display name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-1">
                <label className={text.meta}>Photo URL</label>
                <input
                  type="url"
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          {saved ? <div className="text-sm text-emerald-600">Saved.</div> : null}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </section>

        <section className={cn(surface.cardPadded, "space-y-4")}>
          <div className={text.sectionTitle}>Favorites</div>
          {isLoading ? (
            <div className={text.meta}>Loading favorites…</div>
          ) : favorites.length === 0 ? (
            <div className={text.meta}>No favorites yet.</div>
          ) : (
            <div className="space-y-3">
              {favorites.map((fav) => {
                const isRecording = fav.entityType === "recording";
                const label = isRecording
                  ? `${fav.title ?? "Untitled"}`
                  : `${fav.title ?? "Contributor"}`;
                const subtitle = isRecording ? fav.artist : null;
                const href = isRecording
                  ? `/recording/${fav.entityId}`
                  : `/contributor/${encodeURIComponent(fav.title ?? "")}?mbid=${encodeURIComponent(
                      fav.entityId,
                    )}`;
                return (
                  <div
                    key={`${fav.entityType}:${fav.entityId}`}
                    className={cn(
                      "flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3",
                    )}
                  >
                    <div className="min-w-0">
                      <Link
                        href={href}
                        className="font-semibold text-primary hover:underline"
                      >
                        {label}
                      </Link>
                      {subtitle ? (
                        <div className={cn(text.meta, "text-muted-foreground")}>
                          {subtitle}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        removeFavorite({
                          entityType: fav.entityType,
                          entityId: fav.entityId,
                        })
                      }
                      title="Remove favorite"
                    >
                      <Star className="h-5 w-5 text-yellow-500" fill="currentColor" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
