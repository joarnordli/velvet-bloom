/**
 * Placeholder helpers for TOTP (RFC 6238) two-factor authentication.
 *
 * Real enrollment will swap these for `supabase.auth.mfa.enroll({ factorType: 'totp' })`
 * which returns the actual secret + otpauth URI + QR SVG. For now we render a
 * deterministic, visually obvious stand-in so the UI is fully wired.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a 16-character base32 secret (deterministic per session for placeholder). */
export function generatePlaceholderSecret(): string {
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += BASE32[Math.floor(Math.random() * BASE32.length)];
  }
  return out;
}

/** Format a secret as XXXX-XXXX-XXXX-XXXX for display. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1-");
}

/** Build a standard otpauth:// URI suitable for QR encoding by authenticator apps. */
export function buildOtpauthUri(args: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = args.issuer ?? "Brand";
  const label = encodeURIComponent(`${issuer}:${args.account}`);
  const params = new URLSearchParams({
    secret: args.secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
