import type {
  Adapter,
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken,
} from "next-auth/adapters";
import { ensureAuthTables, getDb } from "@/lib/db";

type DbRow = Record<string, unknown>;

const toDate = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const mapUser = (row: DbRow): AdapterUser => ({
  id: String(row.id ?? ""),
  name: toString(row.name),
  email: String(row.email ?? ""),
  emailVerified: toDate(row.emailVerified),
  image: toString(row.image),
});

const mapSession = (row: DbRow): AdapterSession => ({
  sessionToken: String(row.sessionToken ?? ""),
  userId: String(row.userId ?? ""),
  expires: new Date(String(row.expires ?? "")),
});

const mapVerificationToken = (row: DbRow): VerificationToken => ({
  identifier: String(row.identifier ?? ""),
  token: String(row.token ?? ""),
  expires: new Date(String(row.expires ?? "")),
});

export function libsqlAdapter(): Adapter {
  const db = getDb();
  const ready = ensureAuthTables();

  const getUserById = async (id: string) => {
    await ready;
    const result = await db.execute({
      sql: "select * from users where id = ? limit 1",
      args: [id],
    });
    const row = result.rows[0];
    return row ? mapUser(row as DbRow) : null;
  };

  return {
    async createUser(user: Omit<AdapterUser, "id">) {
      await ready;
      const id = crypto.randomUUID();
      await db.execute({
        sql: `
          insert into users (id, name, email, emailVerified, image)
          values (?, ?, ?, ?, ?)
        `,
        args: [
          id,
          user.name ?? null,
          user.email,
          user.emailVerified ? user.emailVerified.toISOString() : null,
          user.image ?? null,
        ],
      });
      return { ...user, id };
    },
    async getUser(id) {
      return getUserById(id);
    },
    async getUserByEmail(email) {
      await ready;
      const result = await db.execute({
        sql: "select * from users where email = ? limit 1",
        args: [email],
      });
      const row = result.rows[0];
      return row ? mapUser(row as DbRow) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      await ready;
      const result = await db.execute({
        sql: `
          select u.* from users u
          inner join accounts a on a.userId = u.id
          where a.provider = ? and a.providerAccountId = ?
          limit 1
        `,
        args: [provider, providerAccountId],
      });
      const row = result.rows[0];
      return row ? mapUser(row as DbRow) : null;
    },
    async updateUser(user) {
      await ready;
      const existing = await getUserById(user.id);
      if (!existing) {
        throw new Error("User not found");
      }
      const updated = {
        ...existing,
        ...user,
      };
      await db.execute({
        sql: `
          update users
          set name = ?, email = ?, emailVerified = ?, image = ?
          where id = ?
        `,
        args: [
          updated.name ?? null,
          updated.email ?? null,
          updated.emailVerified ? updated.emailVerified.toISOString() : null,
          updated.image ?? null,
          updated.id,
        ],
      });
      return updated;
    },
    async linkAccount(account: AdapterAccount) {
      await ready;
      const id = account.id ?? crypto.randomUUID();
      await db.execute({
        sql: `
          insert into accounts (
            id, userId, type, provider, providerAccountId,
            refresh_token, access_token, expires_at, token_type, scope,
            id_token, session_state, oauth_token_secret, oauth_token
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          id,
          account.userId,
          account.type,
          account.provider,
          account.providerAccountId,
          account.refresh_token ?? null,
          account.access_token ?? null,
          account.expires_at ?? null,
          account.token_type ?? null,
          account.scope ?? null,
          account.id_token ?? null,
          account.session_state ?? null,
          account.oauth_token_secret ?? null,
          account.oauth_token ?? null,
        ],
      });
      return null;
    },
    async createSession(session) {
      await ready;
      const id = crypto.randomUUID();
      await db.execute({
        sql: `
          insert into sessions (id, sessionToken, userId, expires)
          values (?, ?, ?, ?)
        `,
        args: [
          id,
          session.sessionToken,
          session.userId,
          session.expires.toISOString(),
        ],
      });
      return session;
    },
    async getSessionAndUser(sessionToken) {
      await ready;
      const result = await db.execute({
        sql: `
          select s.sessionToken, s.userId, s.expires,
                 u.id, u.name, u.email, u.emailVerified, u.image
          from sessions s
          inner join users u on u.id = s.userId
          where s.sessionToken = ?
          limit 1
        `,
        args: [sessionToken],
      });
      const row = result.rows[0] as DbRow | undefined;
      if (!row) return null;
      return {
        session: mapSession(row),
        user: mapUser(row),
      };
    },
    async updateSession(session) {
      await ready;
      const existing = await db.execute({
        sql: "select * from sessions where sessionToken = ? limit 1",
        args: [session.sessionToken],
      });
      const row = existing.rows[0] as DbRow | undefined;
      if (!row) return null;
      const updated: AdapterSession = {
        sessionToken: session.sessionToken,
        userId: (session.userId ?? row.userId) as string,
        expires: session.expires ?? new Date(String(row.expires ?? "")),
      };
      await db.execute({
        sql: `
          update sessions
          set userId = ?, expires = ?
          where sessionToken = ?
        `,
        args: [
          updated.userId,
          updated.expires.toISOString(),
          updated.sessionToken,
        ],
      });
      return updated;
    },
    async deleteSession(sessionToken) {
      await ready;
      await db.execute({
        sql: "delete from sessions where sessionToken = ?",
        args: [sessionToken],
      });
      return null;
    },
    async createVerificationToken(token) {
      await ready;
      await db.execute({
        sql: `
          insert into verification_tokens (identifier, token, expires)
          values (?, ?, ?)
        `,
        args: [token.identifier, token.token, token.expires.toISOString()],
      });
      return token;
    },
    async useVerificationToken(params) {
      await ready;
      const result = await db.execute({
        sql: `
          select * from verification_tokens
          where identifier = ? and token = ?
          limit 1
        `,
        args: [params.identifier, params.token],
      });
      const row = result.rows[0] as DbRow | undefined;
      if (!row) return null;
      await db.execute({
        sql: `
          delete from verification_tokens
          where identifier = ? and token = ?
        `,
        args: [params.identifier, params.token],
      });
      return mapVerificationToken(row);
    },
  };
}
