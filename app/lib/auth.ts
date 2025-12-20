import NextAuth, { type NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import { getServerSession } from "next-auth/next";
import { libsqlAdapter } from "@/lib/authAdapter";

const emailServer = process.env.EMAIL_SERVER;
const emailFrom = process.env.EMAIL_FROM;

if (!emailServer || !emailFrom) {
  console.warn(
    "Missing EMAIL_SERVER or EMAIL_FROM; Auth.js email magic link will not work.",
  );
}

export const authOptions: NextAuthOptions = {
  adapter: libsqlAdapter(),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  providers: [
    EmailProvider({
      server: emailServer ?? "",
      from: emailFrom ?? "",
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};

export const auth = () => getServerSession(authOptions);

export const authHandler = NextAuth(authOptions);
