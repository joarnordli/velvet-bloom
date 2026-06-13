import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { AppShell } from "@/components/brand/AppShell";
import { SearchPostTile } from "@/components/brand/SearchPostTile";
import { searchAll } from "@/lib/posts.functions";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/oppdag")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "mittpunkt – Oppdag" },
      { name: "description", content: "Søk i innlegg og profiler på mittpunkt." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Oppdag,
});

function Oppdag() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [text, setText] = useState(q);

  useEffect(() => {
    const id = setTimeout(() => {
      if (text !== q) navigate({ search: { q: text }, replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [text, q, navigate]);

  const fetchSearch = useServerFn(searchAll);
  const enabled = q.trim().length >= 2;

  const { data, isFetching } = useQuery({
    queryKey: ["search-all", q],
    queryFn: () => fetchSearch({ data: { q } }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="sticky top-0 md:top-0 z-20 bg-background/85 backdrop-blur px-5 pb-3 pt-2">
          <div className="glass flex items-center gap-2 rounded-full pl-4 pr-3 py-2.5">
            <Search className="h-4 w-4 text-foreground/60" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Søk profiler eller innlegg…"
              inputMode="search"
              enterKeyHint="search"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="pt-4">
          {!enabled && (
            <p className="px-5 text-sm text-muted-foreground">
              Skriv minst 2 tegn for å søke.
            </p>
          )}
          {enabled && isFetching && !data && (
            <p className="px-5 text-sm text-muted-foreground">Søker…</p>
          )}
          {enabled && data && data.users.length === 0 && data.posts.length === 0 && (
            <p className="px-5 text-sm text-muted-foreground">Ingen treff.</p>
          )}

          {data && data.users.length > 0 && (
            <section className="mb-6">
              <h2 className="px-5 mb-2 font-display text-lg tracking-tight">
                Kontoer
              </h2>
              <ul>
                {data.users.map((u) => (
                  <li key={u.id}>
                    <Link
                      to="/u/$username"
                      params={{ username: u.username }}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/5 transition"
                    >
                      <div className="h-11 w-11 shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/10">
                        {u.avatar_url && (
                          <img
                            src={u.avatar_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">
                          {u.username}
                        </p>
                        {u.bio?.trim() && (
                          <p className="text-xs text-muted-foreground truncate">
                            {u.bio}
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data && data.posts.length > 0 && (
            <section>
              <h2 className="px-5 mb-2 font-display text-lg tracking-tight">
                Innlegg
              </h2>
              <div className="grid grid-cols-2 gap-1">
                {data.posts.map((p) => (
                  <SearchPostTile key={p.id} post={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
