import { createClient, type Client } from "@libsql/client";

const databaseUrl = process.env.TURSO_DATABASE_URL ?? "";
if (!databaseUrl) {
  throw new Error("Missing TURSO_DATABASE_URL");
}

const authToken = process.env.TURSO_AUTH_TOKEN;

let client: Client | null = null;

export function getDb(): Client {
  if (!client) {
    client = createClient({ url: databaseUrl, authToken });
  }
  return client;
}

let initPromise: Promise<void> | null = null;
let authInitPromise: Promise<void> | null = null;

export async function ensureFavoritesTable(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb()
      .execute(`
        create table if not exists favorites (
          id text primary key,
          user_id text not null,
          entity_type text not null,
          entity_id text not null,
          title text,
          artist text,
          created_at text default current_timestamp,
          unique (user_id, entity_type, entity_id)
        );
      `)
      .then(() => undefined);
  }

  return initPromise;
}

export async function ensureAuthTables(): Promise<void> {
  if (!authInitPromise) {
    authInitPromise = getDb()
      .execute(`
        create table if not exists users (
          id text primary key,
          name text,
          email text not null unique,
          emailVerified text,
          image text
        );
      `)
      .then(() =>
        getDb().execute(`
          create table if not exists accounts (
            id text primary key,
            userId text not null,
            type text not null,
            provider text not null,
            providerAccountId text not null,
            refresh_token text,
            access_token text,
            expires_at integer,
            token_type text,
            scope text,
            id_token text,
            session_state text,
            oauth_token_secret text,
            oauth_token text,
            foreign key (userId) references users(id) on delete cascade
          );
        `),
      )
      .then(() =>
        getDb().execute(`
          create table if not exists sessions (
            id text primary key,
            sessionToken text not null unique,
            userId text not null,
            expires text not null,
            foreign key (userId) references users(id) on delete cascade
          );
        `),
      )
      .then(() =>
        getDb().execute(`
          create table if not exists verification_tokens (
            identifier text not null,
            token text not null,
            expires text not null,
            primary key (identifier, token)
          );
        `),
      )
      .then(() => undefined);
  }

  return authInitPromise;
}
