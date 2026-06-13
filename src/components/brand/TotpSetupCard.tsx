import { useMemo, useState } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import {
  buildOtpauthUri,
  formatSecret,
  generatePlaceholderSecret,
} from "@/lib/totp";

export function TotpSetupCard({ accountLabel }: { accountLabel: string }) {
  const secret = useMemo(() => generatePlaceholderSecret(), []);
  const uri = useMemo(
    () => buildOtpauthUri({ secret, account: accountLabel }),
    [secret, accountLabel],
  );
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  return (
    <div className="glass rounded-3xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-4 w-4 text-foreground/80" />
        <h3 className="font-display text-lg">Tofaktor-autentisering</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Skann QR-koden med Google Authenticator, Authy eller 1Password. Skriv
        deretter inn den 6-sifrede koden for å aktivere 2FA.
      </p>

      <div className="flex flex-col sm:flex-row gap-5 items-center">
        <PlaceholderQrSvg payload={uri} />

        <div className="flex-1 w-full min-w-0">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Hemmelig nøkkel
          </span>
          <div className="glass rounded-2xl px-3 py-2.5 flex items-center justify-between gap-2">
            <code className="text-xs sm:text-sm font-mono truncate text-foreground/85">
              {formatSecret(secret)}
            </code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 h-8 w-8 grid place-items-center rounded-full hover:bg-white/5"
              aria-label="Kopier nøkkel"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          {copied && (
            <p className="text-[11px] text-[var(--color-online)] mt-1.5">Kopiert</p>
          )}
        </div>
      </div>

      <div className="mt-5">
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          6-sifret kode fra appen
        </label>
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••• •••"
            className="flex-1 glass rounded-2xl px-4 py-3 text-base font-mono tracking-[0.4em] text-center outline-none focus:ring-2 focus:ring-white/15"
          />
          <button
            disabled
            className="px-5 rounded-2xl bg-white/10 text-foreground/40 text-sm font-medium cursor-not-allowed"
            title="Aktiveres når backend-flyten er klar"
          >
            Bekreft
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          TOTP-bekreftelse aktiveres når backend-flyten er klar.
        </p>
      </div>
    </div>
  );
}

/**
 * Deterministic visual stand-in for a real QR code. Pattern derived from the
 * payload hash so two different secrets render differently — but it is NOT
 * scannable. Swap for a real QR (e.g. `qrcode.react`) once Supabase MFA is wired.
 */
function PlaceholderQrSvg({ payload }: { payload: string }) {
  const size = 17;
  const cells = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < payload.length; i++) {
      h ^= payload.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const out: boolean[] = [];
    for (let i = 0; i < size * size; i++) {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      out.push((h & 1) === 1);
    }
    return out;
  }, [payload]);

  const isFinder = (r: number, c: number) => {
    const inBox = (rr: number, cc: number) =>
      (r >= rr && r < rr + 7 && c >= cc && c < cc + 7);
    return inBox(0, 0) || inBox(0, size - 7) || inBox(size - 7, 0);
  };

  return (
    <div className="rounded-2xl bg-white p-3 shadow-xl shadow-black/40 shrink-0">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={148}
        height={148}
        shapeRendering="crispEdges"
        aria-label="QR-kode (plassholder)"
      >
        <rect width={size} height={size} fill="#fff" />
        {cells.map((on, i) => {
          const r = Math.floor(i / size);
          const c = i % size;
          if (isFinder(r, c)) return null;
          if (!on) return null;
          return <rect key={i} x={c} y={r} width={1} height={1} fill="#0a0a0a" />;
        })}
        {/* Three finder patterns */}
        {[
          [0, 0],
          [0, size - 7],
          [size - 7, 0],
        ].map(([y, x], i) => (
          <g key={i}>
            <rect x={x} y={y} width={7} height={7} fill="#0a0a0a" />
            <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
            <rect x={x + 2} y={y + 2} width={3} height={3} fill="#0a0a0a" />
          </g>
        ))}
      </svg>
    </div>
  );
}
