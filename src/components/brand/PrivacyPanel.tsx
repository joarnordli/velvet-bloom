import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, MessageCircle, Heart } from "lucide-react";
import { toast } from "sonner";
import {
  getMyPrivacy,
  updateMyPrivacy,
  type Audience,
  type MyPrivacy,
} from "@/lib/privacy.functions";

const privacyOpts = (fn: () => Promise<MyPrivacy>) =>
  queryOptions({ queryKey: ["my-privacy"], queryFn: fn });

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "everyone", label: "Alle" },
  { value: "followers", label: "Følgere" },
  { value: "mutuals", label: "Gjensidige" },
  { value: "nobody", label: "Ingen" },
];

export function PrivacyPanel() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getMyPrivacy);
  const updateFn = useServerFn(updateMyPrivacy);
  const { data } = useSuspenseQuery(privacyOpts(() => fetchFn()));

  const mutation = useMutation({
    mutationFn: (patch: Partial<MyPrivacy>) =>
      updateFn({
        data: {
          isPrivate: patch.isPrivate,
          allowDmFrom: patch.allowDmFrom,
          allowEngagementFrom: patch.allowEngagementFrom,
        },
      }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["my-privacy"] });
      const prev = qc.getQueryData<MyPrivacy>(["my-privacy"]);
      if (prev) qc.setQueryData<MyPrivacy>(["my-privacy"], { ...prev, ...patch });
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["my-privacy"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSuccess: (fresh) => {
      qc.setQueryData<MyPrivacy>(["my-privacy"], fresh);
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["user-profile"] });
    },
  });

  return (
    <div className="space-y-6">
      <h3 className="font-display text-lg">Personvern</h3>

      <Row
        icon={<Lock className="h-4 w-4" />}
        title="Privat konto"
        description="Når kontoen er privat må folk få godkjenning før de kan se innleggene dine."
      >
        <Switch
          checked={data.isPrivate}
          onCheckedChange={(v) => mutation.mutate({ isPrivate: v })}
        />
      </Row>

      <Row
        icon={<Heart className="h-4 w-4" />}
        title="Hvem kan reagere på innleggene mine"
        description="Likes, kommentarer og reposter. Tall og lister forblir synlige."
      >
        <Radios
          value={data.allowEngagementFrom}
          onChange={(v) => mutation.mutate({ allowEngagementFrom: v })}
        />
      </Row>

      <Row
        icon={<MessageCircle className="h-4 w-4" />}
        title="Hvem kan sende meldinger direkte"
        description="Andre havner i Forespørsler, og kan sende én melding fram til du godtar."
      >
        <Radios
          value={data.allowDmFrom}
          onChange={(v) => mutation.mutate({ allowDmFrom: v })}
        />
      </Row>
    </div>
  );
}

function Row({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-foreground/70">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

function Switch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${
        checked ? "bg-foreground" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-[1.4rem]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Radios({
  value,
  onChange,
}: {
  value: Audience;
  onChange: (v: Audience) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {AUDIENCE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-full text-xs border transition ${
              active
                ? "border-white/40 bg-white/10 text-foreground"
                : "border-white/10 text-foreground/70 hover:border-white/20"
            }`}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
