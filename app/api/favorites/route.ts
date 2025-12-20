import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureFavoritesTable, getDb } from "@/lib/db";

type FavoriteEntityType = "recording" | "contributor";

function isValidEntityType(value: unknown): value is FavoriteEntityType {
  return value === "recording" || value === "contributor";
}

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureFavoritesTable();
  const db = getDb();
  const result = await db.execute({
    sql: `
      select id, user_id, entity_type, entity_id, title, artist, created_at
      from favorites
      where user_id = ?
      order by datetime(created_at) desc
    `,
    args: [userId],
  });

  const favorites = result.rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    entityType: row.entity_type as FavoriteEntityType,
    entityId: row.entity_id as string,
    title: row.title as string | null,
    artist: row.artist as string | null,
    createdAt: row.created_at as string | null,
  }));

  return NextResponse.json({ favorites });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        entityType?: FavoriteEntityType;
        entityId?: string;
        title?: string;
        artist?: string;
      }
    | null;

  if (!body || !isValidEntityType(body.entityType) || !body.entityId) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await ensureFavoritesTable();
  const db = getDb();

  await db.execute({
    sql: `
      insert into favorites (id, user_id, entity_type, entity_id, title, artist)
      values (?, ?, ?, ?, ?, ?)
      on conflict (user_id, entity_type, entity_id) do nothing
    `,
    args: [
      crypto.randomUUID(),
      userId,
      body.entityType,
      body.entityId,
      body.title ?? null,
      body.artist ?? null,
    ],
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        entityType?: FavoriteEntityType;
        entityId?: string;
      }
    | null;

  if (!body || !isValidEntityType(body.entityType) || !body.entityId) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await ensureFavoritesTable();
  const db = getDb();

  await db.execute({
    sql: `
      delete from favorites
      where user_id = ? and entity_type = ? and entity_id = ?
    `,
    args: [userId, body.entityType, body.entityId],
  });

  return NextResponse.json({ success: true });
}
