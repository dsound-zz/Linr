import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureAuthTables, getDb } from "@/lib/db";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureAuthTables();
  const db = getDb();
  const result = await db.execute({
    sql: "select id, name, email, image from users where id = ? limit 1",
    args: [userId],
  });

  const row = result.rows[0];
  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: row.id as string,
      name: row.name as string | null,
      email: row.email as string | null,
      image: row.image as string | null,
    },
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        name?: string | null;
        image?: string | null;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await ensureAuthTables();
  const db = getDb();

  await db.execute({
    sql: "update users set name = ?, image = ? where id = ?",
    args: [body.name ?? null, body.image ?? null, userId],
  });

  return NextResponse.json({
    success: true,
    user: {
      id: userId,
      name: body.name ?? null,
      image: body.image ?? null,
    },
  });
}
