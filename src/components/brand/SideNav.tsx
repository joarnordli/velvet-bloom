import {
  Search,
  Heart,
  Bookmark,
  MessageCircle,
  Home,
  Bell,
  User,
  Eye,
  EyeOff,
  PenLine,
  Upload,
  Camera,
  Plus,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { useDiscreetMode } from "@/context/discreet-mode";
import { WritePostModal } from "./WritePostModal";
import { MediaComposerModal } from "./MediaComposerModal";
import { usePostComposer } from "./usePostComposer";

const navItems = [
  { key: "home", label: "Hjem", icon: Home, to: "/" as const },
  { key: "discover", label: "Oppdag", icon: Search, to: "/oppdag" as const },
  { key: "match", label: "Kink-Match", icon: Heart, to: null },
  { key: "bookmarks", label: "Bokmerker", icon: Bookmark, to: null },
  { key: "messages", label: "Meldinger", icon: MessageCircle, to: "/meldinger" as const },
] as const;

export function SideNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { discreet, toggle } = useDiscreetMode();
  const [composerOpen, setComposerOpen] = useState(false);
  const c = usePostComposer();

  return (
    <aside className="hidden md:flex fixed left-4 top-4 bottom-4 z-40 w-60 flex-col glass-strong rounded-[2rem] overflow-hidden">
      <div className="px-6 pt-6">
        <h1 className="font-display text-3xl leading-none tracking-tight">mittpunkt</h1>
      </div>

      <nav className="mt-6 px-3 flex-1 overflow-y-auto">
        <ul className="space-y-1">
          {navItems.map((it) => {
            const isActive = it.to ? pathname === it.to : false;
            const Icon = it.icon;
            const inner = (
              <>
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.7} />
                <span className="truncate">{it.label}</span>
              </>
            );
            const cls = `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
              isActive
                ? "bg-white/10 text-foreground"
                : "text-foreground/70 hover:text-foreground hover:bg-white/5"
            }`;
            return (
              <li key={it.key}>
                {it.to ? (
                  <Link to={it.to} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className={`${cls} w-full text-left opacity-50 cursor-not-allowed`}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 px-1 relative">
          <button
            onClick={() => setComposerOpen((o) => !o)}
            className="w-full glass-strong rounded-full px-4 py-3 flex items-center justify-center gap-2 text-sm font-medium hover:scale-[1.01] active:scale-[0.99] transition"
          >
            <Plus className="h-4 w-4" />
            Nytt innlegg
          </button>

          {composerOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setComposerOpen(false)}
                aria-hidden
              />
              <div className="absolute left-1 right-1 mt-2 z-40 glass-strong rounded-2xl p-1.5 space-y-1">
                {[
                  {
                    key: "write",
                    label: "Skriv",
                    icon: PenLine,
                    onClick: () => {
                      setComposerOpen(false);
                      c.setWriteOpen(true);
                    },
                  },
                  {
                    key: "upload",
                    label: "Last opp",
                    icon: Upload,
                    onClick: () => {
                      setComposerOpen(false);
                      c.openUpload();
                    },
                  },
                  {
                    key: "camera",
                    label: "Kamera",
                    icon: Camera,
                    onClick: () => {
                      setComposerOpen(false);
                      c.openCamera();
                    },
                  },
                ].map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      onClick={opt.onClick}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-foreground/85 hover:text-foreground hover:bg-white/5 transition"
                    >
                      <Icon className="h-4 w-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

        </div>
      </nav>

      <div className="px-3 pb-5 pt-3 border-t border-white/5">
        <div className="flex items-center gap-1">
          <button
            aria-label="Diskret modus"
            onClick={toggle}
            className="h-10 w-10 rounded-full grid place-items-center text-foreground/80 hover:text-foreground hover:bg-white/5 transition"
          >
            {discreet ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
          <button
            aria-label="Varsler"
            disabled
            className="h-10 w-10 rounded-full grid place-items-center text-foreground/40 cursor-not-allowed"
          >
            <Bell className="h-5 w-5" />
          </button>
          <Link
            to="/profile"
            aria-label="Profil"
            className={`ml-auto h-10 w-10 rounded-full grid place-items-center transition ${
              pathname === "/profile"
                ? "bg-white/10 text-foreground"
                : "text-foreground/80 hover:text-foreground hover:bg-white/5"
            }`}
          >
            <User className="h-5 w-5" />
          </Link>
        </div>
      </div>

      <input
        ref={c.uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={c.handleFile}
      />
      <input
        ref={c.cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={c.handleFile}
      />
      <WritePostModal open={c.writeOpen} onClose={() => c.setWriteOpen(false)} />
      <MediaComposerModal
        open={!!c.pendingFile}
        file={c.pendingFile}
        previewUrl={c.previewUrl}
        phase={c.phase}
        errorMessage={c.errorMessage}
        onPublish={c.publish}
        onClose={c.clearPendingFile}
      />
    </aside>
  );
}
