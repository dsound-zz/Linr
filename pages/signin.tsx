import * as React from "react";
import type { GetServerSideProps } from "next";
import { getCsrfToken, signIn } from "next-auth/react";
import { Mail } from "lucide-react";

import { AppLayout } from "@components/layout/app-layout";
import { Button } from "@components/ui/button";
import { cn } from "@/lib/utils";
import { surface, text } from "@styles/typeography";

type SignInProps = {
  csrfToken: string | null;
};

export default function SignInPage({ csrfToken }: SignInProps) {
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    await signIn("email", {
      email,
      callbackUrl: "/profile",
    });
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-md">
        <div className={cn(surface.cardPadded, "space-y-5")}>
          <div className="space-y-1">
            <div className={text.sectionTitle}>Sign in</div>
            <div className={cn(text.meta, "text-muted-foreground")}>
              We’ll email you a magic link to sign in.
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
            <label className="space-y-2">
              <span className={text.meta}>Email address</span>
              <div className="flex mb-4 items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-transparent text-sm outline-none"
                  autoComplete="email"
                  required
                />
              </div>
            </label>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Sending…" : "Send magic link"}
            </Button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps<SignInProps> = async (
  context,
) => {
  const csrfToken = await getCsrfToken(context);
  return { props: { csrfToken: csrfToken ?? null } };
};
