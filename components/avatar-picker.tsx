"use client";

import { useRef } from "react";
import { clearAvatarAction, setAvatarAction } from "@/app/actions";
import { ActError, useRefreshingAct } from "./use-act";

const SIDE = 256;

/** Center-crop to a square and downscale so a phone photo lands under the server's 512 KB cap. */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const crop = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(
    bitmap,
    (bitmap.width - crop) / 2,
    (bitmap.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    SIDE,
    SIDE,
  );
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      0.85,
    );
  });
}

export function AvatarPicker({ hasCustom }: { hasCustom: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { pending, error, act } = useRefreshingAct();

  const upload = (file: File) =>
    act(async () => {
      let blob: Blob;
      try {
        blob = await downscale(file);
      } catch {
        return { ok: false, error: "Couldn't read that image. Try a JPEG or PNG." };
      }
      const formData = new FormData();
      formData.append("avatar", blob, "avatar.jpg");
      return setAvatarAction(formData);
    });

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload(file);
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="btn btn-line px-2 py-1 text-xs"
        >
          {pending ? "Saving…" : "Change picture"}
        </button>
        {hasCustom && (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(clearAvatarAction)}
            className="btn btn-link px-2 py-1 text-xs text-soft"
          >
            Use my initials
          </button>
        )}
      </div>
      <ActError error={error} block />
    </div>
  );
}
