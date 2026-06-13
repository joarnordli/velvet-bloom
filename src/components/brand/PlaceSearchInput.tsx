import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, Loader2 } from "lucide-react";
import { searchPlaces, type PlaceHit } from "@/lib/places.functions";

export function PlaceSearchInput({
  value,
  onChange,
  placeholder = "Søk etter sted",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const fetchPlaces = useServerFn(searchPlaces);
  const [query, setQuery] = useState(value);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  // Keep input in sync if parent value changes (e.g. reset).
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const myId = ++requestId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchPlaces({ data: { q } });
        if (requestId.current !== myId) return;
        setHits(res);
        setOpen(res.length > 0);
      } catch {
        if (requestId.current !== myId) return;
        setHits([]);
      } finally {
        if (requestId.current === myId) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, fetchPlaces]);

  // Close on outside click.
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const select = (label: string) => {
    onChange(label);
    setQuery(label);
    setHits([]);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Treat free typing as the value too — user may want a place not in the index.
            onChange(e.target.value);
          }}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder={placeholder}
          maxLength={80}
          autoComplete="off"
          className="w-full bg-transparent border-b border-white/10 focus:border-white/30 outline-none pl-9 pr-9 py-1.5 text-sm"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
        )}
      </div>

      {open && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-2 z-20 max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-background/95 backdrop-blur-xl shadow-xl py-1">
          {hits.map((h) => (
            <li key={h.label}>
              <button
                type="button"
                onClick={() => select(h.label)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-white/5 transition"
              >
                <span className="text-foreground/90 truncate">{h.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                  {h.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
