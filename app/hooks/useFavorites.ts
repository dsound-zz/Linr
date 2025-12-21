"use client";

import * as React from "react";

export type FavoriteEntityType = "recording" | "contributor";

export type Favorite = {
  id: string;
  userId: string;
  entityType: FavoriteEntityType;
  entityId: string;
  title: string | null;
  artist: string | null;
  createdAt: string | null;
};

type FavoritePayload = {
  entityType: FavoriteEntityType;
  entityId: string;
  title?: string | null;
  artist?: string | null;
};

type RemovePayload = {
  entityType: FavoriteEntityType;
  entityId: string;
};

export function useFavorites() {
  const [favorites, setFavorites] = React.useState<Favorite[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/favorites");
        if (cancelled) return;
        if (res.status === 401) {
          setFavorites([]);
          return;
        }
        const json = (await res.json()) as { favorites?: Favorite[] };
        setFavorites(Array.isArray(json.favorites) ? json.favorites : []);
      } catch {
        if (!cancelled) setFavorites([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const isFavorited = React.useCallback(
    (entityType: FavoriteEntityType, entityId: string) =>
      favorites.some(
        (fav) => fav.entityType === entityType && fav.entityId === entityId,
      ),
    [favorites],
  );

  const addFavorite = React.useCallback(
    async (payload: FavoritePayload): Promise<boolean> => {
      if (isFavorited(payload.entityType, payload.entityId)) {
        return true;
      }

      const tempId = `temp-${Date.now()}-${payload.entityId}`;
      const optimistic: Favorite = {
        id: tempId,
        userId: "me",
        entityType: payload.entityType,
        entityId: payload.entityId,
        title: payload.title ?? null,
        artist: payload.artist ?? null,
        createdAt: new Date().toISOString(),
      };

      setFavorites((prev) => [optimistic, ...prev]);

      try {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 401) {
          setFavorites((prev) => prev.filter((f) => f.id !== tempId));
          return false;
        }
        if (!res.ok) {
          setFavorites((prev) => prev.filter((f) => f.id !== tempId));
          return false;
        }
        return true;
      } catch {
        setFavorites((prev) => prev.filter((f) => f.id !== tempId));
        return false;
      }
    },
    [isFavorited],
  );

  const removeFavorite = React.useCallback(
    async (payload: RemovePayload): Promise<boolean> => {
      const previous = favorites;
      setFavorites((prev) =>
        prev.filter(
          (fav) =>
            !(
              fav.entityType === payload.entityType &&
              fav.entityId === payload.entityId
            ),
        ),
      );

      try {
        const res = await fetch("/api/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 401) {
          setFavorites(previous);
          return false;
        }
        if (!res.ok) {
          setFavorites(previous);
          return false;
        }
        return true;
      } catch {
        setFavorites(previous);
        return false;
      }
    },
    [favorites],
  );

  return {
    favorites,
    isLoading,
    addFavorite,
    removeFavorite,
    isFavorited,
  };
}
