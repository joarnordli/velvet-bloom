import { Eye, EyeOff, Bell, User } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useDiscreetMode } from "@/context/discreet-mode";
import { useOnlinePresence } from "@/hooks/use-online-presence";
import { useUnreadCounts } from "@/hooks/use-unread-counts";

export function TopNav() {
  const { discreet, toggle } = useDiscreetMode();
  const online = useOnlinePresence();
  const { notifications: notifCount } = useUnreadCounts();
  return (
    <header className="app-top-nav z-40 md:hidden bg-background border-b border-white/5 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto max-w-2xl px-5 pt-4 pb-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none tracking-tight text-foreground">
              mittpunkt
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-online)] opacity-60 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-online)]" />
              </span>
              <span className="text-xs text-muted-foreground">{online} pålogget</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              aria-label="Diskret modus"
              onClick={toggle}
              className="glass h-11 w-11 rounded-full grid place-items-center text-foreground/85 hover:text-foreground transition"
            >
              {discreet ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
            <div className="glass flex items-center rounded-full px-1.5 py-1.5 gap-1">
              <Link
                to="/varsler"
                aria-label="Varsler"
                className="relative h-9 w-9 rounded-full grid place-items-center text-foreground/85 hover:bg-white/5 transition"
              >
                <Bell className="h-[18px] w-[18px]" />
                {notifCount > 0 && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[var(--color-notif-dot)] ring-2 ring-background" />
                )}
              </Link>
              <Link
                to="/profile"
                aria-label="Profil"
                className="h-9 w-9 rounded-full grid place-items-center text-foreground/85 hover:bg-white/5 transition"
              >
                <User className="h-[18px] w-[18px]" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
