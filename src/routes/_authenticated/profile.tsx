import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useRef, useState } from "react";
import { ArrowLeft, LogOut, Camera, Pencil, Check, Settings } from "lucide-react";
import { getMyProfile, updateMyProfile, getMyPosts, type MyProfile, type FeedPost } from "@/lib/posts.functions";
import { uploadAvatar } from "@/lib/upload-avatar";
import { authClient } from "@/lib/auth-client";
import { TotpSetupCard } from "@/components/brand/TotpSetupCard";
import { PostCard } from "@/components/brand/PostCard";
import { AppShell } from "@/components/brand/AppShell";
import { PlaceSearchInput } from "@/components/brand/PlaceSearchInput";
import { PrivacyPanel } from "@/components/brand/PrivacyPanel";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profil – mittpunkt" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProfilePage,
});

const profileOpts = (fn: () => Promise<MyProfile | null>) =>
  queryOptions({ queryKey: ["me"], queryFn: fn });

const myPostsOpts = (fn: () => Promise<FeedPost[]>) =>
  queryOptions({ queryKey: ["me-posts"], queryFn: fn });

type Tab = "profile" | "edit" | "posts" | "settings";

function ProfilePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("profile");

  async function handleSignOut() {
    await authClient.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <header className="px-5 flex items-center gap-3 h-12">
          <Link
            to="/"
            className="h-9 w-9 grid place-items-center rounded-full hover:bg-white/5 md:hidden"
            aria-label="Tilbake"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <button
            onClick={() => setTab(tab === "settings" ? "profile" : "settings")}
            aria-label={tab === "settings" ? "Lukk innstillinger" : "Innstillinger"}
            aria-pressed={tab === "settings"}
            className={`ml-auto h-9 w-9 grid place-items-center rounded-full transition ${
              tab === "settings"
                ? "bg-white/10 text-foreground"
                : "text-foreground/80 hover:text-foreground hover:bg-white/5"
            }`}
          >
            <Settings className="h-4 w-4" />
          </button>
        </header>

        {tab !== "settings" && tab !== "edit" && (
          <div className="px-5 mt-4">
            <div className="flex p-1 rounded-full bg-white/5 max-w-md">
              {(["profile", "posts"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 text-sm rounded-full transition ${
                    tab === t ? "bg-white/10 text-foreground" : "text-foreground/60"
                  }`}
                >
                  {t === "profile" ? "Profil" : "Innlegg"}
                </button>
              ))}
            </div>
          </div>
        )}

        <Suspense fallback={<div className="px-5 mt-8 h-40 animate-pulse opacity-40" />}>
          {tab === "profile" && <ProfileTab onEdit={() => setTab("edit")} />}
          {tab === "edit" && <EditTab onDone={() => setTab("profile")} />}
          {tab === "posts" && <PostsTab />}
          {tab === "settings" && <SettingsTab onSignOut={handleSignOut} />}
        </Suspense>
      </div>
    </AppShell>
  );
}

/* -------- Profil tab (read view) -------- */

function ProfileTab({ onEdit }: { onEdit: () => void }) {
  const fetchMe = useServerFn(getMyProfile);
  const { data } = useSuspenseQuery(profileOpts(() => fetchMe()));
  if (!data) return null;

  const attrs = [data.region, data.gender, data.situation, data.looking_for, data.orientation].filter(
    (s): s is string => !!s && s.trim().length > 0,
  );

  return (
    <div className="px-5 mt-6">
      <div className="flex items-start gap-5">
        <AvatarBlock profile={data} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl truncate flex-1">@{data.username}</h2>
            <button
              onClick={onEdit}
              aria-label="Rediger profil"
              className="shrink-0 h-9 w-9 grid place-items-center rounded-full text-foreground/80 hover:text-foreground hover:bg-white/5 transition"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground/80">{data.followerCount}</span> følgere
            <span className="mx-1.5">·</span>
            <span className="font-semibold text-foreground/80">{data.followingCount}</span> følger
          </p>
          {attrs.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">{attrs.join(" · ")}</p>
          )}
        </div>
      </div>

      <div className="mt-5">
        {data.bio?.trim() ? (
          <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">{data.bio}</p>
        ) : (
          <button
            onClick={onEdit}
            className="text-sm text-muted-foreground italic hover:text-foreground/80 transition text-left"
          >
            Skriv noe om deg selv
          </button>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {data.kinks.length === 0 ? (
          <button
            onClick={onEdit}
            className="text-sm text-muted-foreground italic hover:text-foreground/80 transition"
          >
            Legg til kinks
          </button>
        ) : (
          data.kinks.map((k) => (
            <span
              key={k}
              className="inline-flex items-center px-3 py-1.5 rounded-full text-xs border border-white/10 bg-white/5 text-foreground/90"
            >
              {k}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function AvatarBlock({ profile }: { profile: MyProfile }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateMyProfile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      setStatus("Laster opp…");
      const { path } = await uploadAvatar(file);
      await updateFn({ data: { avatar_path: path } });
    },
    onSuccess: () => {
      setStatus(null);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => {
      setStatus(`Feil: ${(err as Error).message}`);
      setTimeout(() => setStatus(null), 3500);
    },
  });

  return (
    <div className="relative shrink-0">
      <div className="h-20 w-20 rounded-full overflow-hidden bg-gradient-to-br from-white/25 to-white/5 ring-1 ring-white/15">
        {profile.avatar_url && (
          <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
        )}
      </div>
      <button
        onClick={() => inputRef.current?.click()}
        aria-label="Bytt profilbilde"
        className="absolute -right-1 -bottom-1 h-8 w-8 rounded-full grid place-items-center glass-strong text-foreground/90 hover:text-foreground transition"
      >
        <Camera className="h-3.5 w-3.5" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) mutation.mutate(f);
        }}
      />
      {status && (
        <p className="absolute -bottom-6 left-0 text-[10px] text-muted-foreground whitespace-nowrap">
          {status}
        </p>
      )}
    </div>
  );
}

/* -------- Edit tab -------- */

const GENDER_OPTIONS = ["Kvinne", "Mann", "Ikke-binær", "Annet"];
const SITUATION_OPTIONS = ["Singel", "I forhold", "Åpent forhold", "Polyamorøs", "Gift", "Komplisert"];
const ORIENTATION_OPTIONS = ["Heterofil", "Homofil", "Bifil", "Panfil", "Aseksuell", "Annet"];
const LOOKING_FOR_OPTIONS = ["Vennskap", "Langvarig forhold", "Flørt", "ONS"];
const KINK_OPTIONS = [
  "Anal", "BDSM", "Blodlek", "Bondage", "Brat", "Caning", "CNC (samtykkebasert)",
  "Cosplay", "Cuckold", "Daddy/Mommy", "DDLG/MDLB", "Degradering", "Dominans",
  "Edging", "Eksibisjonisme", "Fisting", "Flogging", "Fotfetisj", "Gruppesex",
  "Hotwife", "Impact play", "Kyskhet", "Latex", "Little", "Lær", "Massasje",
  "Nålestikk", "Orgasmekontroll", "Pegging", "Petplay", "Ponyplay", "Primal play",
  "Rollespill", "Sensorisk lek", "Sensuell dominans", "Shibari", "Spanking",
  "Squirting", "Strømpebukser", "Submission", "Swinging", "Switch", "Tantra",
  "Temperaturlek", "Tickling", "Trekant", "Uniformer", "Verbal lek",
  "Voyeurisme", "Wax play",
].sort((a, b) => a.localeCompare(b, "nb"));

function EditTab({ onDone }: { onDone: () => void }) {
  const fetchMe = useServerFn(getMyProfile);
  const { data } = useSuspenseQuery(profileOpts(() => fetchMe()));
  const qc = useQueryClient();
  const updateFn = useServerFn(updateMyProfile);

  const [region, setRegion] = useState(data?.region ?? "");
  const [gender, setGender] = useState(data?.gender ?? "");
  const [orientation, setOrientation] = useState(data?.orientation ?? "");
  const [situation, setSituation] = useState(data?.situation ?? "");
  const [lookingFor, setLookingFor] = useState<string[]>(
    data?.looking_for ? data.looking_for.split(",").map((s) => s.trim()).filter(Boolean) : [],
  );
  const [bio, setBio] = useState(data?.bio ?? "");
  const [kinks, setKinks] = useState<string[]>(data?.kinks ?? []);

  const save = useMutation({
    mutationFn: async () => {
      await updateFn({
        data: {
          region: region.trim() || null,
          gender: gender.trim() || null,
          orientation: orientation.trim() || null,
          situation: situation.trim() || null,
          looking_for: lookingFor.length ? lookingFor.join(", ") : null,
          bio: bio.trim() || null,
          kinks,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      onDone();
    },
  });

  const toggleInArray = (
    list: string[],
    setList: (next: string[]) => void,
    item: string,
    max: number,
  ) => {
    if (list.includes(item)) setList(list.filter((x) => x !== item));
    else if (list.length < max) setList([...list, item]);
  };

  if (!data) return null;

  return (
    <div className="px-5 mt-6 space-y-8 pb-12">
      <Field label="Region">
        <PlaceSearchInput
          value={region}
          onChange={setRegion}
          placeholder="Søk etter sted, f.eks. Oslo"
        />
      </Field>

      <Field label="Kjønn">
        <Chips options={GENDER_OPTIONS} value={gender} onChange={setGender} />
      </Field>

      <Field label="Orientering">
        <Chips options={ORIENTATION_OPTIONS} value={orientation} onChange={setOrientation} />
      </Field>

      <Field label="Situasjon">
        <Chips options={SITUATION_OPTIONS} value={situation} onChange={setSituation} />
      </Field>

      <Field label="Ser etter">
        <MultiChips
          options={LOOKING_FOR_OPTIONS}
          values={lookingFor}
          onToggle={(opt) => toggleInArray(lookingFor, setLookingFor, opt, LOOKING_FOR_OPTIONS.length)}
        />
      </Field>

      <Field label="Bio">
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={8}
          maxLength={2000}
          placeholder="Fortell hvem du er, hva du liker, hva du leter etter…"
          className="w-full bg-transparent border border-white/10 focus:border-white/30 rounded-2xl px-3 py-2 outline-none text-sm resize-none"
        />
        <p className="mt-1 text-[10px] text-muted-foreground text-right">
          {bio.length} / 2000
        </p>
      </Field>

      <Field label="Kinks">
        <MultiChips
          options={KINK_OPTIONS}
          values={kinks}
          onToggle={(opt) => toggleInArray(kinks, setKinks, opt, 30)}
        />
        <p className="mt-2 text-[10px] text-muted-foreground">
          {kinks.length} / 30 valgt
        </p>
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={onDone}
          className="h-10 px-4 rounded-full text-sm text-foreground/70 hover:text-foreground hover:bg-white/5 transition"
        >
          Avbryt
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="h-10 px-5 rounded-full text-sm bg-white/10 hover:bg-white/15 text-foreground transition flex items-center gap-1.5 disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          Lagre
        </button>
      </div>
    </div>
  );
}

function MultiChips({
  options,
  values,
  onToggle,
}: {
  options: string[];
  values: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={active}
            className={`px-3 py-1.5 rounded-full text-xs border transition ${
              active
                ? "border-white/40 bg-white/10 text-foreground"
                : "border-white/10 text-foreground/70 hover:border-white/20"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{label}</p>
      {children}
    </div>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 rounded-full text-xs border transition ${
            value === opt
              ? "border-white/40 bg-white/10 text-foreground"
              : "border-white/10 text-foreground/70 hover:border-white/20"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/* -------- Innlegg tab -------- */

function PostsTab() {
  const fetchMine = useServerFn(getMyPosts);
  const { data } = useSuspenseQuery(myPostsOpts(() => fetchMine()));
  if (!data.length) {
    return (
      <p className="px-5 mt-10 text-sm text-muted-foreground text-center">
        Du har ikke postet noe enda.
      </p>
    );
  }
  return (
    <div className="mt-4">
      {data.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </div>
  );
}

/* -------- Innstillinger tab -------- */

function SettingsTab({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  const fetchMe = useServerFn(getMyProfile);
  const { data } = useSuspenseQuery(profileOpts(() => fetchMe()));
  return (
    <div className="px-5 mt-6 space-y-8">
      <TotpSetupCard accountLabel={data?.username ?? "bruker"} />
      <PrivacyPanel />
      <div>
        <h3 className="font-display text-lg mb-2">Data</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Vi lagrer kun det du selv velger å fylle ut. Ingen GPS-koordinater,
          ingen sporing, ingen tredjepartsanalyse. Bilder du laster opp får all
          EXIF-metadata fjernet før de forlater enheten din.
        </p>
      </div>
      <div className="border-t border-white/5 pt-6">
        <button
          onClick={() => void onSignOut()}
          className="w-full h-11 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 text-sm flex items-center justify-center gap-2 text-foreground/80 hover:text-foreground transition"
        >
          <LogOut className="h-4 w-4" />
          Logg ut
        </button>
      </div>
    </div>
  );
}
