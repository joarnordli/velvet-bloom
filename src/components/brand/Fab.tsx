import { Plus, PenLine, Upload, Camera } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePostComposer } from "./usePostComposer";
import { useDeferredUnmount } from "@/hooks/use-deferred-unmount";

const WritePostModal = lazy(() =>
  import("./WritePostModal").then((m) => ({ default: m.WritePostModal })),
);
const MediaComposerModal = lazy(() =>
  import("./MediaComposerModal").then((m) => ({ default: m.MediaComposerModal })),
);

const EASE = [0.32, 0.72, 0, 1] as const;

export function Fab() {
  const [open, setOpen] = useState(false);
  const c = usePostComposer();

  const writeMounted = useDeferredUnmount(c.writeOpen, 320);
  const mediaOpen = !!c.pendingFile;
  const mediaMounted = useDeferredUnmount(mediaOpen, 320);

  const options = [
    {
      key: "write",
      label: "Skriv",
      icon: PenLine,
      onClick: () => {
        setOpen(false);
        c.setWriteOpen(true);
      },
    },
    { key: "upload", label: "Last opp", icon: Upload, onClick: c.openUpload },
    { key: "camera", label: "Kamera", icon: Camera, onClick: c.openCamera },
  ];

  return (
    <>
      <div
        className="fixed right-5 z-40 md:hidden flex flex-col items-end"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 6.5rem)" }}
      >
        <AnimatePresence>
          {open && (
            <motion.div
              key="scrim"
              className="fixed inset-0 -z-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
              aria-hidden
            />
          )}
        </AnimatePresence>

        <div className="flex flex-col items-end gap-2 mb-2">
          <AnimatePresence>
            {open &&
              options.map((opt, i) => {
                const Icon = opt.icon;
                return (
                  <motion.button
                    key={opt.key}
                    onClick={() => {
                      setOpen(false);
                      opt.onClick();
                    }}
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: EASE, delay: i * 0.035 }}
                    className="glass-strong rounded-full pl-4 pr-3 py-2.5 flex items-center gap-3 text-sm text-foreground/90 hover:text-foreground"
                  >
                    <span>{opt.label}</span>
                    <span className="h-8 w-8 rounded-full grid place-items-center bg-white/5 ring-1 ring-white/10">
                      <Icon className="h-4 w-4" />
                    </span>
                  </motion.button>
                );
              })}
          </AnimatePresence>
        </div>

        <button
          aria-label={open ? "Lukk meny" : "Ny post"}
          onClick={() => setOpen((o) => !o)}
          className="glass-strong h-14 w-14 rounded-full grid place-items-center text-foreground hover:scale-[1.04] active:scale-95 transition"
        >
          <Plus
            className={`h-6 w-6 transition-transform duration-300 ease-out ${
              open ? "rotate-45" : "rotate-0"
            }`}
          />
        </button>
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

      <Suspense fallback={null}>
        {writeMounted && (
          <WritePostModal open={c.writeOpen} onClose={() => c.setWriteOpen(false)} />
        )}
        {mediaMounted && (
          <MediaComposerModal
            open={mediaOpen}
            file={c.pendingFile}
            previewUrl={c.previewUrl}
            phase={c.phase}
            errorMessage={c.errorMessage}
            onPublish={c.publish}
            onClose={c.clearPendingFile}
          />
        )}
      </Suspense>
    </>
  );
}
