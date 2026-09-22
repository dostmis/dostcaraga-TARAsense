"use client";

import { Crop, ImageUp, RotateCcw, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FIC_ID_ACCEPT_ATTRIBUTE,
  FIC_ID_ASPECT_RATIO,
  FIC_ID_OUTPUT_QUALITY,
  MAX_FIC_ID_BYTES,
  MAX_FIC_ID_SOURCE_BYTES,
  ficIdOutputSize,
  type FicIdOrientation,
} from "@/lib/fic-facility";

/**
 * Crop frame size in CSS pixels. Fixed rather than measured so the pan/zoom maths
 * stays exact, and kept under 320px wide so the whole frame fits a phone screen.
 */
const FRAME_LONG_EDGE = 300;
const FRAME_SHORT_EDGE = Math.round(FRAME_LONG_EDGE / FIC_ID_ASPECT_RATIO);
const MAX_ZOOM = 3;

function frameSize(orientation: FicIdOrientation) {
  return orientation === "landscape"
    ? { width: FRAME_LONG_EDGE, height: FRAME_SHORT_EDGE }
    : { width: FRAME_SHORT_EDGE, height: FRAME_LONG_EDGE };
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

type GovIdUploadProps = {
  /** Form field name — the cropped result is written back into this file input. */
  name: string;
  required: boolean;
  /** Link to the document already on file, when re-applying or editing a profile. */
  existingHref?: string | null;
};

export function GovIdUpload({ name, required, existingHref }: GovIdUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<FicIdOrientation>("landscape");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [result, setResult] = useState<{ url: string; bytes: number } | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Mirror the live object URLs into a ref (from an effect, never during render)
  // so unmount revokes whichever ones are current rather than the initial nulls.
  const liveUrlsRef = useRef<{ source: string | null; result: string | null }>({ source: null, result: null });
  useEffect(() => {
    liveUrlsRef.current = { source: sourceUrl, result: result?.url ?? null };
  }, [sourceUrl, result]);
  useEffect(
    () => () => {
      const urls = liveUrlsRef.current;
      if (urls.source) URL.revokeObjectURL(urls.source);
      if (urls.result) URL.revokeObjectURL(urls.result);
    },
    [],
  );

  const frame = frameSize(orientation);

  /** Scale at which the image exactly covers the frame — the zoom=1 baseline. */
  const baseScale = imageSize
    ? Math.max(frame.width / imageSize.width, frame.height / imageSize.height)
    : 1;
  const scale = baseScale * zoom;
  const rendered = imageSize
    ? { width: imageSize.width * scale, height: imageSize.height * scale }
    : { width: 0, height: 0 };
  const maxOffsetX = Math.max(0, (rendered.width - frame.width) / 2);
  const maxOffsetY = Math.max(0, (rendered.height - frame.height) / 2);

  const clampOffset = useCallback(
    (next: { x: number; y: number }) => ({
      x: Math.min(maxOffsetX, Math.max(-maxOffsetX, next.x)),
      y: Math.min(maxOffsetY, Math.max(-maxOffsetY, next.y)),
    }),
    [maxOffsetX, maxOffsetY],
  );

  // Re-clamp whenever the frame or zoom changes, so the image never exposes a gap.
  useEffect(() => {
    setOffset((current) => ({
      x: Math.min(maxOffsetX, Math.max(-maxOffsetX, current.x)),
      y: Math.min(maxOffsetY, Math.max(-maxOffsetY, current.y)),
    }));
  }, [maxOffsetX, maxOffsetY]);

  function resetCropState() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function clearSelection() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (result) URL.revokeObjectURL(result.url);
    setSourceUrl(null);
    setResult(null);
    setImageSize(null);
    setPdfName(null);
    resetCropState();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    if (!file) {
      clearSelection();
      return;
    }

    // PDFs cannot be cropped on a canvas, so they pass straight through and are
    // held to the same size limit the server enforces.
    if (file.type === "application/pdf") {
      if (file.size > MAX_FIC_ID_BYTES) {
        setError(`That PDF is ${formatBytes(file.size)}. Please upload one under 5MB.`);
        event.target.value = "";
        return;
      }
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (result) URL.revokeObjectURL(result.url);
      setSourceUrl(null);
      setResult(null);
      setImageSize(null);
      setPdfName(file.name);
      return;
    }

    if (file.size > MAX_FIC_ID_SOURCE_BYTES) {
      setError(`That image is ${formatBytes(file.size)}. Please choose one under 25MB.`);
      event.target.value = "";
      return;
    }

    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setPdfName(null);
    resetCropState();
    setSourceUrl(URL.createObjectURL(file));

    // Drop the original from the input straight away. The crop step puts the
    // re-encoded file back; until then `required` blocks submitting the raw
    // multi-megabyte photo, which is the upload that was being rejected.
    event.target.value = "";
  }

  function handleImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset(
      clampOffset({
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      }),
    );
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
  }

  /**
   * Render the visible crop window to a canvas at the fixed output size and write
   * the JPEG back into the file input, so the form submits the cropped image and
   * never the multi-megabyte original.
   */
  async function applyCrop() {
    const img = imageRef.current;
    const input = fileInputRef.current;
    if (!img || !input || !imageSize) return;

    setIsProcessing(true);
    setError(null);
    try {
      const output = ficIdOutputSize(orientation);
      const canvas = document.createElement("canvas");
      canvas.width = output.width;
      canvas.height = output.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no-2d-context");

      // Map the frame back onto the source image: the frame's top-left corner in
      // image coordinates, then the frame's size scaled down to source pixels.
      const sx = (rendered.width / 2 - frame.width / 2 - offset.x) / scale;
      const sy = (rendered.height / 2 - frame.height / 2 - offset.y) / scale;
      const sw = frame.width / scale;
      const sh = frame.height / scale;

      context.imageSmoothingQuality = "high";
      context.drawImage(img, sx, sy, sw, sh, 0, 0, output.width, output.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", FIC_ID_OUTPUT_QUALITY),
      );
      if (!blob) throw new Error("encode-failed");

      const cropped = new File([blob], "government-id.jpg", { type: "image/jpeg" });
      const transfer = new DataTransfer();
      transfer.items.add(cropped);
      input.files = transfer.files;

      if (result) URL.revokeObjectURL(result.url);
      setResult({ url: URL.createObjectURL(blob), bytes: blob.size });
    } catch {
      setError("Could not process that image. Please try a different photo or upload a PDF instead.");
    } finally {
      setIsProcessing(false);
    }
  }

  const isCropping = Boolean(sourceUrl) && !result;

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        name={name}
        type="file"
        accept={FIC_ID_ACCEPT_ATTRIBUTE}
        onChange={handleFileChange}
        required={required}
        className="block w-full text-sm text-[#5d493b] file:mr-3 file:rounded-lg file:border-0 file:bg-[#f3e7da] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[#5a4536] hover:file:bg-[#ecdaca]"
      />
      <p className="text-xs text-[#8d735f]">
        JPG or PNG photo of your ID — you&apos;ll crop it to the required size on the next step. PDFs are
        accepted as-is (max 5MB).
      </p>

      {isCropping ? (
        <div className="space-y-3 rounded-xl border border-[#e6d6c6] bg-[#fdf8f3] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#5a4536]">
              <Crop size={15} /> Position your ID
            </span>
            <div className="inline-flex overflow-hidden rounded-lg border border-[#e0cdb9]">
              {(["landscape", "portrait"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setOrientation(option);
                    resetCropState();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    orientation === option
                      ? "bg-[#c2410c] text-white"
                      : "bg-white text-[#6f5b4f] hover:bg-[#f7ede3]"
                  }`}
                >
                  {option === "landscape" ? "Horizontal" : "Vertical"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-center">
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ width: frame.width, height: frame.height }}
              className="relative cursor-grab overflow-hidden rounded-lg border-2 border-dashed border-[#c2410c] bg-[#efe4d8] touch-none active:cursor-grabbing"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imageRef}
                src={sourceUrl ?? ""}
                alt="Government ID preview"
                onLoad={handleImageLoad}
                draggable={false}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: rendered.width || undefined,
                  height: rendered.height || undefined,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  maxWidth: "none",
                }}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[#6f5b4f]">
            <ZoomIn size={14} />
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="h-1 flex-1 cursor-pointer accent-[#c2410c]"
              aria-label="Zoom"
            />
          </label>

          <p className="text-center text-xs text-[#8d735f]">Drag the image to reposition it inside the frame.</p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyCrop}
              disabled={!imageSize || isProcessing}
              className="app-button-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {isProcessing ? "Processing…" : "Apply crop"}
            </button>
            <button type="button" onClick={clearSelection} className="app-button-secondary px-4 py-2 text-sm">
              Choose another photo
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3 rounded-xl border border-[#cfe6d4] bg-[#f4fbf5] p-4">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#166534]">
            <ImageUp size={15} /> ID ready to submit
          </span>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.url}
              alt="Cropped government ID"
              className="rounded-lg border border-[#cfe6d4]"
              style={frameSize(orientation)}
            />
            <div className="space-y-2 text-xs text-[#4b6b52]">
              <p>
                {orientation === "landscape" ? "Horizontal" : "Vertical"} ·{" "}
                {ficIdOutputSize(orientation).width}×{ficIdOutputSize(orientation).height}px ·{" "}
                {formatBytes(result.bytes)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (result) URL.revokeObjectURL(result.url);
                    setResult(null);
                  }}
                  className="inline-flex items-center gap-1.5 font-medium text-[#c2410c] underline"
                >
                  <RotateCcw size={13} /> Adjust crop
                </button>
                <button type="button" onClick={clearSelection} className="font-medium text-[#6f5b4f] underline">
                  Choose another photo
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pdfName ? (
        <p className="rounded-lg border border-[#e6d6c6] bg-[#fdf8f3] px-3 py-2 text-xs text-[#6f5b4f]">
          PDF selected: <span className="font-medium">{pdfName}</span> — it will be uploaded as-is.
        </p>
      ) : null}

      {error ? <p className="text-xs font-medium text-[#b91c1c]">{error}</p> : null}

      {existingHref ? (
        <p className="text-xs text-[#6f5b4f]">
          A document is already on file.{" "}
          <a href={existingHref} target="_blank" rel="noopener noreferrer" className="font-medium text-[#c2410c] underline">
            View current ID
          </a>
          . Upload a new file to replace it.
        </p>
      ) : null}
    </div>
  );
}
