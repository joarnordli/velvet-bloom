import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PlaceHit = {
  /** Display label, e.g. "Oslo" or "Sandnes (Rogaland)" */
  label: string;
  /** Stedsnavn type, e.g. "By", "Tettsted", "Bygd" */
  type: string;
};

const inputSchema = z.object({
  q: z.string().trim().min(1).max(80),
});

// Only administrative areas, never individual places (settlements, farms,
// bus stops, etc.). Keeps profiles from accidentally pinpointing tiny villages.
const ADMIN_TYPES = new Set(["Kommune", "Fylke"]);

// Norway's 5 landsdeler aren't in Kartverket's stedsnavn index — match locally.
const LANDSDELER = [
  "Nord-Norge",
  "Trøndelag",
  "Vestlandet",
  "Sørlandet",
  "Østlandet",
];

type KartverketNavn = {
  skrivemåte?: string;
  skrivemaate?: string;
  navneobjekttype?: string;
  kommuner?: Array<{ kommunenavn?: string; fylkesnavn?: string }>;
  fylker?: Array<{ fylkesnavn?: string }>;
};

function stripSuffix(name: string, type: string): string {
  // Kartverket returns "Oslo kommune" / "Oslo fylke" — the type chip already
  // says "Kommune"/"Fylke", so drop the suffix for a cleaner label.
  const suffix = type.toLowerCase();
  const lower = name.toLowerCase();
  if (lower.endsWith(` ${suffix}`)) return name.slice(0, name.length - suffix.length - 1);
  return name;
}

export const searchPlaces = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<PlaceHit[]> => {
    const q = data.q;
    const qLower = q.toLowerCase();

    // 1) Landsdel matches (local, instant).
    const landsdelHits: PlaceHit[] = LANDSDELER.filter((l) =>
      l.toLowerCase().startsWith(qLower),
    ).map((l) => ({ label: l, type: "Landsdel" }));

    // 2) Kartverket — restrict to admin areas only.
    const url = new URL("https://ws.geonorge.no/stedsnavn/v1/navn");
    url.searchParams.set("sok", `${q}*`);
    url.searchParams.set("fuzzy", "true");
    url.searchParams.set("utkoordsys", "4326");
    url.searchParams.set("treffPerSide", "40");
    url.searchParams.set("side", "1");
    // navneobjekttype accepts repeated values
    url.searchParams.append("navneobjekttype", "Kommune");
    url.searchParams.append("navneobjekttype", "Fylke");

    let navn: KartverketNavn[] = [];
    try {
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (res.ok) {
        const json = (await res.json()) as { navn?: KartverketNavn[] };
        navn = json.navn ?? [];
      }
    } catch {
      navn = [];
    }

    const seen = new Set<string>(landsdelHits.map((h) => h.label.toLowerCase()));
    const fylker: PlaceHit[] = [];
    const kommuner: PlaceHit[] = [];

    for (const n of navn) {
      const raw = n.skrivemåte ?? n.skrivemaate;
      const type = n.navneobjekttype ?? "";
      if (!raw || !ADMIN_TYPES.has(type)) continue;

      const name = stripSuffix(raw, type);
      const fylke = n.kommuner?.[0]?.fylkesnavn ?? n.fylker?.[0]?.fylkesnavn ?? null;
      const label =
        type === "Kommune" && fylke && fylke.toLowerCase() !== name.toLowerCase()
          ? `${name} (${fylke})`
          : name;

      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      (type === "Fylke" ? fylker : kommuner).push({ label, type });
    }

    // Order: landsdel → fylke → kommune. Cap at 10.
    return [...landsdelHits, ...fylker, ...kommuner].slice(0, 10);
  });
