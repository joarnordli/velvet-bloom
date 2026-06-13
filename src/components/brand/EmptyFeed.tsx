import { Sparkles } from "lucide-react";

export function EmptyFeed() {
  return (
    <div className="px-5 pt-8">
      <div className="glass rounded-3xl px-6 py-10 text-center">
        <div className="mx-auto h-12 w-12 rounded-full grid place-items-center bg-white/5 ring-1 ring-white/10 mb-4">
          <Sparkles className="h-5 w-5 text-foreground/70" />
        </div>
        <h3 className="font-display text-xl mb-1.5">Ingen poster ennå</h3>
        <p className="text-sm text-muted-foreground">
          Trykk på <span className="text-foreground">+</span> for å dele noe med
          fellesskapet.
        </p>
      </div>
    </div>
  );
}
