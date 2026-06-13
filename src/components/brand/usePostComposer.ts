import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { uploadPostMedia } from "@/lib/upload";
import { createPost } from "@/lib/posts.functions";

export type ComposerPhase = "idle" | "uploading" | "success" | "error";

/**
 * Shared post composer state used by the mobile Fab and the desktop sidebar.
 * Media flow: pick file -> review modal (caption + preview) -> publish.
 */
export function usePostComposer() {
  const [writeOpen, setWriteOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<ComposerPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  const createPostFn = useServerFn(createPost);

  const previewUrl = useMemo(
    () => (pendingFile ? URL.createObjectURL(pendingFile) : null),
    [pendingFile],
  );
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const publishMutation = useMutation({
    mutationFn: async ({ file, caption }: { file: File; caption: string }) => {
      const { path } = await uploadPostMedia(file);
      await createPostFn({
        data: { body: caption.trim() || " ", imagePath: path },
      });
    },
    onMutate: () => {
      setPhase("uploading");
      setErrorMessage(null);
    },
    onSuccess: () => {
      setPhase("success");
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["me-posts"] });
      // Close after a brief success animation.
      setTimeout(() => {
        setPendingFile(null);
        setPhase("idle");
      }, 700);
    },
    onError: (err) => {
      setPhase("error");
      setErrorMessage((err as Error).message);
    },
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingFile(file);
    setPhase("idle");
    setErrorMessage(null);
  };

  const clearPendingFile = () => {
    if (publishMutation.isPending) return;
    setPendingFile(null);
    setPhase("idle");
    setErrorMessage(null);
  };

  const publish = (caption: string) => {
    if (!pendingFile || publishMutation.isPending) return;
    publishMutation.mutate({ file: pendingFile, caption });
  };

  return {
    writeOpen,
    setWriteOpen,
    uploadInputRef,
    cameraInputRef,
    handleFile,
    openUpload: () => uploadInputRef.current?.click(),
    openCamera: () => cameraInputRef.current?.click(),
    pendingFile,
    previewUrl,
    clearPendingFile,
    publish,
    phase,
    errorMessage,
  };
}
