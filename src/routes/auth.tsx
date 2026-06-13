import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Logg inn – mittpunkt" },
      { name: "description", content: "Logg inn eller registrer en konto på mittpunkt." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const signUpSchema = z
  .object({
    email: z.string().trim().email("Ugyldig e-postadresse").max(254),
    username: z
      .string()
      .trim()
      .min(3, "Minst 3 tegn")
      .max(24, "Maks 24 tegn")
      .regex(/^[a-z0-9_]+$/, "Kun små bokstaver, tall og understrek"),
    password: z.string().min(8, "Minst 8 tegn").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passordene er ikke like",
  });

const signInSchema = z.object({
  email: z.string().trim().email("Ugyldig e-postadresse"),
  password: z.string().min(1, "Påkrevd"),
});

type Mode = "signin" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Already signed in → go home
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const fd = new FormData(e.currentTarget);

    setBusy(true);
    try {
      if (mode === "signup") {
        const parsed = signUpSchema.safeParse({
          email: fd.get("email"),
          username: fd.get("username"),
          password: fd.get("password"),
          confirm: fd.get("confirm"),
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Sjekk feltene");
          return;
        }
        const { email, username, password } = parsed.data;
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username },
          },
        });
        if (err) {
          setError(err.message);
          return;
        }
        if (!data.session) {
          setNotice("Sjekk e-posten din for å bekrefte kontoen.");
          return;
        }
        navigate({ to: "/" });
      } else {
        const parsed = signInSchema.safeParse({
          email: fd.get("email"),
          password: fd.get("password"),
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Sjekk feltene");
          return;
        }
        const { error: err } = await supabase.auth.signInWithPassword(parsed.data);
        if (err) {
          setError(err.message);
          return;
        }
        navigate({ to: "/" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link to="/auth" className="block text-center mb-8">
          <h1 className="font-display text-5xl tracking-tight">mittpunkt</h1>
          <p className="text-xs text-muted-foreground mt-2">
            Eksklusivt. Anonymt. Norsk.
          </p>
        </Link>

        <div className="glass-strong rounded-3xl p-6">
          <div className="flex p-1 rounded-full bg-white/5 mb-6">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setNotice(null);
                }}
                className={`flex-1 py-2 text-sm rounded-full transition ${
                  mode === m
                    ? "bg-white/10 text-foreground shadow-inner"
                    : "text-foreground/60"
                }`}
              >
                {m === "signin" ? "Logg inn" : "Registrer"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <Field
              name="email"
              label="E-post"
              type="email"
              autoComplete="email"
              required
            />
            {mode === "signup" && (
              <Field
                name="username"
                label="Brukernavn"
                type="text"
                autoComplete="username"
                placeholder="kun små bokstaver, tall, _"
                required
              />
            )}
            <Field
              name="password"
              label="Passord"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
            />
            {mode === "signup" && (
              <Field
                name="confirm"
                label="Bekreft passord"
                type="password"
                autoComplete="new-password"
                required
              />
            )}

            {error && (
              <p className="text-sm text-[oklch(0.72_0.18_25)] pt-1">{error}</p>
            )}
            {notice && (
              <p className="text-sm text-[var(--color-online)] pt-1">{notice}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full mt-2 py-3 rounded-full bg-white text-black font-medium text-sm hover:bg-white/90 transition disabled:opacity-50"
            >
              {busy
                ? "Vent…"
                : mode === "signin"
                  ? "Logg inn"
                  : "Opprett konto"}
            </button>
          </form>
        </div>

        <p className="text-[11px] text-muted-foreground text-center mt-6 px-4">
          Vi lagrer kun det vi trenger. Ingen tredjepartsinnlogging, ingen GPS,
          ingen sporing.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="block">
      <span className="block text-xs text-foreground/70 mb-1.5 ml-1">{label}</span>
      <input
        name={name}
        {...rest}
        className="w-full glass rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 focus:ring-white/15 transition"
      />
    </label>
  );
}
