import type { AppProps } from "next/app";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";

import "../styles/globals.css";

import { ThemeProvider } from "@components/theme-provider";

export default function App({ Component, pageProps }: AppProps) {
  const { session, ...rest } = pageProps as { session?: Session };
  return (
    <SessionProvider session={session}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <Component {...rest} />
      </ThemeProvider>
    </SessionProvider>
  );
}
