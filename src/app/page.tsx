"use client";

import type { ChangeEvent, DragEvent } from "react";
import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import AuditCard from "@/components/AuditCard";
import ProductCard from "@/components/ProductCard";
import type {
  Product,
  ProductSearchProgressEvent,
  ProductSearchStageId,
  StyleAudit,
} from "@/lib/types";

type ViewState = "idle" | "photo" | "text" | "loading" | "result";
type ImageUploadStatus = "idle" | "uploading" | "ready" | "error";

type ProductSearchStreamEvent =
  | ProductSearchProgressEvent
  | { type: "result"; products: Product[] }
  | { type: "error"; message: string };

interface ProductSearchStage {
  id: ProductSearchStageId;
  label: string;
  detail: string;
  stat: string;
}

const samplePrompts = [
  "Quiet luxury dinner look under $200 with sharper accessories.",
  "Make this feel more directional without looking overdressed.",
  "Build a sleek monochrome fit for a gallery opening.",
];

const stageMeta: Record<
  ViewState,
  { eyebrow: string; title: string; description: string }
> = {
  idle: {
    eyebrow: "Open Session",
    title: "Choose how you want to start.",
    description:
      "Upload a look for an instant audit or write a sharp brief and let Archive build the direction.",
  },
  photo: {
    eyebrow: "Photo Audit",
    title: "Frame the outfit, then add context.",
    description:
      "A quick note on occasion, budget, or what feels off makes the response much more precise.",
  },
  text: {
    eyebrow: "Text Brief",
    title: "Describe the energy you want.",
    description:
      "Mention silhouette, setting, budget, or reference points so the recommendations feel intentional.",
  },
  loading: {
    eyebrow: "In Analysis",
    title: "Building your audit and shopping direction.",
    description:
      "The audit lands first, then live product search keeps filling in the strongest next pieces.",
  },
  result: {
    eyebrow: "Result Ready",
    title: "Your style audit is live.",
    description:
      "Read the signal, keep the parts that work, and move directly into sharper product picks.",
  },
};

const productSearchStages: ProductSearchStage[] = [
  {
    id: "intent",
    label: "Reading the audit intent",
    detail:
      "Separating missing pieces from garments that are already working.",
    stat: "Audit signals",
  },
  {
    id: "discovery",
    label: "Finding live candidates",
    detail:
      "Searching retailer pages for products that match the shopping direction.",
    stat: "Live discovery",
  },
  {
    id: "vetting",
    label: "Vetting product pages",
    detail:
      "Checking each page for product evidence, price, image, retailer, and USD currency.",
    stat: "Strict validation",
  },
  {
    id: "fallback",
    label: "Balancing the final grid",
    detail:
      "Adding curated fallback only where the live results are too light.",
    stat: "Quality pass",
  },
];

export default function Home() {
  const [view, setView] = useState<ViewState>("idle");
  const [textPrompt, setTextPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [occasion, setOccasion] = useState("");
  const [audit, setAudit] = useState<StyleAudit | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearchProgress, setProductSearchProgress] =
    useState<ProductSearchProgressEvent | null>(null);
  const [imageUploadId, setImageUploadId] = useState<string | null>(null);
  const [imageUploadStatus, setImageUploadStatus] =
    useState<ImageUploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageUploadAbortRef = useRef<AbortController | null>(null);
  const imageUploadPromiseRef = useRef<Promise<string | null> | null>(null);
  const displayedProducts = useDeferredValue(products);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const canSubmit =
    (view === "photo" && Boolean(selectedFile)) ||
    (view === "text" && textPrompt.trim().length > 0);
  const canRetry =
    Boolean(selectedFile) || textPrompt.trim().length > 0 || Boolean(audit);
  const meta = stageMeta[view];
  const showContextRail = view === "result" && Boolean(audit);

  const openTextMode = (seedPrompt = textPrompt) => {
    startTransition(() => {
      setView("text");
      setTextPrompt(seedPrompt);
      setError(null);
    });
  };

  const openIdle = () => {
    startTransition(() => {
      setView("idle");
      setError(null);
    });
  };

  const selectFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      startTransition(() => {
        setError("Use a JPG, PNG, or WebP image for the outfit audit.");
      });
      return;
    }

    const nextPreview = URL.createObjectURL(file);

    startTransition(() => {
      setSelectedFile(file);
      setPreviewUrl(nextPreview);
      setView("photo");
      setError(null);
    });

    startImagePreUpload(file);
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      selectFile(file);
    }
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      selectFile(file);
    }
  };

  const handleFileDragState = (dragging: boolean) => {
    setIsDragging(dragging);
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const startImagePreUpload = (file: File) => {
    imageUploadAbortRef.current?.abort();

    const controller = new AbortController();
    imageUploadAbortRef.current = controller;

    const uploadPromise = (async () => {
      startTransition(() => {
        setImageUploadId(null);
        setImageUploadStatus("uploading");
      });

      try {
        const imageBase64 = await fileToBase64(file);
        if (controller.signal.aborted) {
          return null;
        }

        const response = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: imageBase64 }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`);
        }

        const data = (await response.json()) as {
          image_upload_id?: string;
        };
        if (!data.image_upload_id) {
          throw new Error("Upload response missing image_upload_id");
        }

        if (!controller.signal.aborted) {
          startTransition(() => {
            setImageUploadId(data.image_upload_id || null);
            setImageUploadStatus("ready");
          });
        }

        return data.image_upload_id;
      } catch (uploadError) {
        if (controller.signal.aborted) {
          return null;
        }

        console.warn("[uploads] pre-upload failed:", uploadError);
        startTransition(() => {
          setImageUploadId(null);
          setImageUploadStatus("error");
        });
        return null;
      }
    })();

    imageUploadPromiseRef.current = uploadPromise;
    void uploadPromise;
  };

  const loadProducts = async (loadedAudit: StyleAudit) => {
    setProductsLoading(true);
    setProductSearchProgress({
      type: "progress",
      stage: "intent",
      status: "active",
      detail: "Sending the audit signals to product search.",
    });

    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopping_queries: loadedAudit.shopping_queries,
          shopping_intents: loadedAudit.shopping_intents,
          recommended_categories: loadedAudit.recommended_categories,
          missing_pieces: loadedAudit.missing_pieces,
          what_works: loadedAudit.what_works,
          what_to_fix: loadedAudit.what_to_fix,
          budget,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Product search failed: ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (response.body && contentType.includes("application/x-ndjson")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return;
          }

          const event = JSON.parse(trimmed) as ProductSearchStreamEvent;
          if (event.type === "progress") {
            startTransition(() => {
              setProductSearchProgress(event);
            });
          } else if (event.type === "result") {
            startTransition(() => {
              setProducts(event.products || []);
            });
          } else if (event.type === "error") {
            console.warn("[products] stream warning:", event.message);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              handleLine(line);
            }
          }

          if (done) {
            break;
          }
        }

        if (buffer.trim()) {
          handleLine(buffer);
        }
      } else {
        const data = await response.json();
        startTransition(() => {
          setProducts(data.products || []);
        });
      }
    } catch (productError) {
      console.error("[products] load error:", productError);
      startTransition(() => {
        setProducts([]);
        setProductSearchProgress(null);
      });
    } finally {
      startTransition(() => {
        setProductsLoading(false);
      });
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    startTransition(() => {
      setView("loading");
      setError(null);
      setProducts([]);
      setProductsLoading(false);
      setProductSearchProgress(null);
    });

    try {
      const body: Record<string, string> = {};

      if (textPrompt.trim()) {
        body.prompt = textPrompt.trim();
      }
      if (selectedFile) {
        const uploadedImageId =
          imageUploadId || (await imageUploadPromiseRef.current);

        if (uploadedImageId) {
          body.image_upload_id = uploadedImageId;
        } else {
          body.image_base64 = await fileToBase64(selectedFile);
        }
      }
      if (occasion.trim()) {
        body.occasion = occasion.trim();
      }
      if (budget.trim()) {
        body.budget = budget.trim();
      }

      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      const loadedAudit = data.audit as StyleAudit;

      startTransition(() => {
        setAudit(loadedAudit);
        setView("result");
      });

      void loadProducts(loadedAudit);
    } catch (submitError) {
      console.error("[submit] Error:", submitError);

      const fallbackView: ViewState = selectedFile
        ? "photo"
        : textPrompt.trim()
          ? "text"
          : "idle";

      startTransition(() => {
        setError("The audit didn’t complete cleanly. Try again or adjust the brief.");
        setView(fallbackView);
      });
    }
  };

  const handleReset = () => {
    startTransition(() => {
      setView("idle");
      setTextPrompt("");
      setSelectedFile(null);
      setPreviewUrl(null);
      setBudget("");
      setOccasion("");
      setAudit(null);
      setProducts([]);
      setProductsLoading(false);
      setProductSearchProgress(null);
      setImageUploadId(null);
      setImageUploadStatus("idle");
      setError(null);
      setIsDragging(false);
    });

    imageUploadAbortRef.current?.abort();
    imageUploadAbortRef.current = null;
    imageUploadPromiseRef.current = null;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRetry = () => {
    if (canSubmit) {
      void handleSubmit();
      return;
    }

    if (audit) {
      startTransition(() => {
        setView("result");
        setError(null);
      });
      return;
    }

    openIdle();
  };

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <div className="mx-auto flex min-h-screen w-full max-w-[1340px] flex-col px-4 pb-6 pt-4 sm:px-6 lg:px-8">
        <header className="liquid-panel sticky top-4 z-20 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <button
              onClick={handleReset}
              className="flex items-center gap-4 text-left transition-transform duration-200 ease-out hover:-translate-y-0.5"
            >
              <div className="grid h-12 w-12 place-items-center rounded-[18px] border border-white/12 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="h-5 w-5 rounded-full bg-[radial-gradient(circle,_rgba(255,255,255,0.95),_rgba(177,187,205,0.35))] shadow-[0_0_18px_rgba(228,234,245,0.3)]" />
              </div>
              <div>
                <p className="section-label">Archive Beta</p>
                <p className="mt-1 text-lg font-semibold tracking-[-0.04em] text-silver-strong">
                  AI fashion broker
                </p>
              </div>
            </button>

            <div className="text-right">
              <p className="section-label">{meta.eyebrow}</p>
              <p className="mt-1 text-sm tracking-[0.01em] text-[color:var(--foreground-soft)]">
                {view === "result"
                  ? `${productsLoading ? "Searching" : displayedProducts.length} shopping picks live`
                  : "Dark glass beta experience"}
              </p>
            </div>
          </div>
        </header>

        <main className="flex-1 py-6 sm:py-8">
          <div
            className={
              showContextRail
                ? "grid gap-6 xl:grid-cols-[minmax(300px,0.34fr)_minmax(0,1fr)]"
                : "mx-auto max-w-[980px]"
            }
          >
            {showContextRail && audit && (
              <ContextRail
                audit={audit}
                budget={budget}
                occasion={occasion}
                previewUrl={previewUrl}
                selectedFile={selectedFile}
              />
            )}

            <section className="liquid-panel min-h-[720px] p-5 sm:p-6 lg:p-7">
              <div className="flex h-full flex-col">
                <div className="hairline-bottom pb-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-2xl">
                      <p className="section-label">{meta.eyebrow}</p>
                      <h2 className="mt-2 text-balance text-3xl font-semibold tracking-[-0.05em] text-silver-strong sm:text-4xl">
                        {meta.title}
                      </h2>
                      <p className="mt-3 max-w-xl text-sm leading-7 text-[color:var(--foreground-soft)] sm:text-[0.98rem]">
                        {meta.description}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {view !== "idle" && view !== "loading" && (
                        <button onClick={handleReset} className="secondary-action">
                          Start over
                        </button>
                      )}
                      {view === "text" && (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="secondary-action"
                        >
                          Use photo instead
                        </button>
                      )}
                      {view === "photo" && (
                        <button
                          onClick={() => openTextMode()}
                          className="secondary-action"
                        >
                          Switch to text
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="motion-rise mt-5 flex flex-col gap-3 rounded-[24px] border border-[#f2c8c8]/15 bg-[#1a0f10]/70 px-4 py-4 text-sm text-[#f4d9d9] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-2xl border border-white/8 bg-white/[0.04]">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      </div>
                      <p className="text-[0.93rem] leading-6 text-[#f4d9d9]">{error}</p>
                    </div>

                    <button
                      onClick={handleRetry}
                      className="secondary-action min-w-[140px] border-white/12"
                      disabled={!canRetry}
                    >
                      Try again
                    </button>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <div className="flex-1 pt-5 sm:pt-6">
                  {view === "idle" && (
                    <div className="motion-rise">
                      <IdleStage
                        isDragging={isDragging}
                        onBrowse={() => fileInputRef.current?.click()}
                        onDragStateChange={handleFileDragState}
                        onDrop={handleDrop}
                        onOpenText={openTextMode}
                      />
                    </div>
                  )}

                  {view === "photo" && previewUrl && (
                    <div className="motion-rise">
                      <PhotoStage
                        budget={budget}
                        occasion={occasion}
                        onBack={openIdle}
                        onBrowse={() => fileInputRef.current?.click()}
                        onBudgetChange={setBudget}
                        onOccasionChange={setOccasion}
                        onPromptChange={setTextPrompt}
                        onSubmit={handleSubmit}
                        previewUrl={previewUrl}
                        selectedFile={selectedFile}
                        textPrompt={textPrompt}
                        imageUploadStatus={imageUploadStatus}
                      />
                    </div>
                  )}

                  {view === "text" && (
                    <div className="motion-rise">
                      <TextStage
                        budget={budget}
                        occasion={occasion}
                        onBack={openIdle}
                        onBudgetChange={setBudget}
                        onOccasionChange={setOccasion}
                        onPromptChange={setTextPrompt}
                        onSeedPrompt={openTextMode}
                        onSubmit={handleSubmit}
                        textPrompt={textPrompt}
                      />
                    </div>
                  )}

                  {view === "loading" && <LoadingStage />}

                  {view === "result" && audit && (
                    <div className="motion-rise">
                      <ResultStage
                        audit={audit}
                        onReset={handleReset}
                        products={displayedProducts}
                        productsLoading={productsLoading}
                        productSearchProgress={productSearchProgress}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </main>

        <footer className="px-2 py-3 text-center">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--silver-muted)]">
            Archive Beta • Dark glass UI refresh • Mobile first, desktop sharp
          </p>
        </footer>
      </div>
    </div>
  );
}

function ContextRail({
  audit,
  budget,
  occasion,
  previewUrl,
  selectedFile,
}: {
  audit: StyleAudit;
  budget: string;
  occasion: string;
  previewUrl: string | null;
  selectedFile: File | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <section className="liquid-panel motion-rise overflow-hidden p-4 sm:p-5">
        <p className="section-label">Live Context</p>

        <div className="mt-4">
          {previewUrl ? (
            <div className="liquid-tile overflow-hidden">
              <div className="relative aspect-[4/5] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Selected outfit preview"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,4,6,0.04)_0%,rgba(3,4,6,0.18)_40%,rgba(3,4,6,0.82)_100%)]" />
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <div className="space-y-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--silver-strong)]/78">
                    <p>Score {audit.score.toFixed(1)} / 10</p>
                    {selectedFile?.name && (
                      <p className="truncate text-[color:var(--silver-strong)]/58">
                        {selectedFile.name}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : audit ? (
            <div className="liquid-tile p-5">
              <p className="section-label">Aesthetic Read</p>
              <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-silver-strong">
                {audit.aesthetic_read}
              </p>
              <p className="mt-3 text-sm leading-7 text-[color:var(--foreground-soft)]">
                {audit.summary}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--silver-muted)]">
                {audit.recommended_categories.slice(0, 3).map((category) => (
                  <span key={category}>{category}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="liquid-panel motion-rise motion-delay-1 p-5">
        <p className="section-label">Session Details</p>
        <div className="mt-4 space-y-3">
          <SignalRow label="Mode" value="audit result" />
          <SignalRow
            label="Occasion"
            value={occasion.trim() || "not specified"}
          />
          <SignalRow label="Budget" value={budget.trim() || "open"} />
        </div>
      </section>
    </div>
  );
}

function IdleStage({
  isDragging,
  onBrowse,
  onDragStateChange,
  onDrop,
  onOpenText,
}: {
  isDragging: boolean;
  onBrowse: () => void;
  onDragStateChange: (dragging: boolean) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  onOpenText: (seedPrompt?: string) => void;
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <button
          onClick={onBrowse}
          onDragOver={(event) => event.preventDefault()}
          onDragEnter={() => onDragStateChange(true)}
          onDragLeave={() => onDragStateChange(false)}
          onDrop={onDrop}
          className={`liquid-tile sheen-hover magnetic-lift group min-h-[320px] p-6 text-left transition-colors duration-300 ${
            isDragging ? "border-white/22 bg-white/[0.08]" : ""
          }`}
        >
          <div className="flex h-full flex-col justify-between">
            <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/12 bg-white/[0.06]">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-silver-strong"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>

            <div>
              <p className="section-label">Photo Input</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-silver-strong">
                Drag in a fit.
              </h3>
              <p className="mt-3 max-w-sm text-sm leading-7 text-[color:var(--foreground-soft)]">
                Drop a JPG, PNG, or WebP. The photo frame is sized to feel like
                a deliberate stage, not a generic upload box.
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => onOpenText()}
          className="liquid-tile sheen-hover magnetic-lift min-h-[320px] p-6 text-left"
        >
          <div className="flex h-full flex-col justify-between">
            <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/12 bg-white/[0.06]">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-silver-strong"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>

            <div>
              <p className="section-label">Text Brief</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-silver-strong">
                Write the direction.
              </h3>
              <p className="mt-3 max-w-sm text-sm leading-7 text-[color:var(--foreground-soft)]">
                Describe the silhouette, setting, and spend range. Archive will
                respond with a structured read and shopping path.
              </p>
            </div>
          </div>
        </button>
      </div>

      <div className="liquid-tile p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-label">Sample Directives</p>
            <p className="mt-2 text-sm leading-7 text-[color:var(--foreground-soft)]">
              Seed the brief with something specific, then refine it after the
              first audit.
            </p>
          </div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--silver-muted)]">
            3 fast starts
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {samplePrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onOpenText(prompt)}
              className="secondary-action min-h-[2.8rem] rounded-full px-4 text-left text-[0.84rem] font-medium"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhotoStage({
  budget,
  occasion,
  onBack,
  onBrowse,
  onBudgetChange,
  onOccasionChange,
  onPromptChange,
  onSubmit,
  previewUrl,
  selectedFile,
  textPrompt,
  imageUploadStatus,
}: {
  budget: string;
  occasion: string;
  onBack: () => void;
  onBrowse: () => void;
  onBudgetChange: (value: string) => void;
  onOccasionChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  previewUrl: string;
  selectedFile: File | null;
  textPrompt: string;
  imageUploadStatus: ImageUploadStatus;
}) {
  const uploadLabel =
    imageUploadStatus === "ready"
      ? "Photo preloaded"
      : imageUploadStatus === "uploading"
        ? "Photo preloading"
        : imageUploadStatus === "error"
          ? "Photo local fallback"
          : "Photo loaded";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.75fr)]">
      <div className="liquid-tile overflow-hidden">
        <div className="relative aspect-[4/5]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Selected outfit"
            className="h-full w-full object-cover"
          />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,4,6,0.08)_0%,rgba(3,4,6,0.16)_35%,rgba(3,4,6,0.8)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 p-5">
          <div className="space-y-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--silver-strong)]/78">
            <p>{uploadLabel}</p>
            {selectedFile?.name && (
              <p className="truncate text-[color:var(--silver-strong)]/58">
                {selectedFile.name}
              </p>
            )}
          </div>
        </div>
      </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="liquid-tile p-5">
          <label htmlFor="photo-note" className="section-label">
            Optional Note
          </label>
          <textarea
            id="photo-note"
            rows={6}
            placeholder="What should Archive push toward or fix? Example: make this cleaner, more elevated, and sharper through the waist."
            value={textPrompt}
            onChange={(event) => onPromptChange(event.target.value)}
            className="input-surface mt-3 min-h-[180px] resize-none leading-7"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="photo-occasion"
            label="Occasion"
            placeholder="date night, office, gallery"
            value={occasion}
            onChange={onOccasionChange}
          />
          <Field
            id="photo-budget"
            label="Budget"
            placeholder="$150, flexible, investment"
            value={budget}
            onChange={onBudgetChange}
          />
        </div>

        <div className="mt-auto flex flex-col gap-3 sm:flex-row">
          <button onClick={onBack} className="secondary-action sm:flex-1">
            Back
          </button>
          <button onClick={onBrowse} className="secondary-action sm:flex-1">
            Replace photo
          </button>
          <button onClick={onSubmit} className="primary-action sm:flex-[1.4]">
            Audit this outfit
          </button>
        </div>
      </div>
    </div>
  );
}

function TextStage({
  budget,
  occasion,
  onBack,
  onBudgetChange,
  onOccasionChange,
  onPromptChange,
  onSeedPrompt,
  onSubmit,
  textPrompt,
}: {
  budget: string;
  occasion: string;
  onBack: () => void;
  onBudgetChange: (value: string) => void;
  onOccasionChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSeedPrompt: (seedPrompt?: string) => void;
  onSubmit: () => void;
  textPrompt: string;
}) {
  return (
    <div className="grid gap-5">
      <div className="liquid-tile p-5 sm:p-6">
        <label htmlFor="text-prompt" className="section-label">
          Style Brief
        </label>
        <textarea
          id="text-prompt"
          autoFocus
          rows={8}
          placeholder="Describe the outfit goal, where you're going, your budget, and the kind of energy you want."
          value={textPrompt}
          onChange={(event) => onPromptChange(event.target.value)}
          className="input-surface mt-3 min-h-[240px] resize-none leading-7"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="text-occasion"
          label="Occasion"
          placeholder="dinner, campus, wedding guest"
          value={occasion}
          onChange={onOccasionChange}
        />
        <Field
          id="text-budget"
          label="Budget"
          placeholder="$200, under $350, open"
          value={budget}
          onChange={onBudgetChange}
        />
      </div>

      <div className="liquid-tile p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-label">Prompt Starters</p>
            <p className="mt-2 text-sm leading-7 text-[color:var(--foreground-soft)]">
              Use one as a base, then tune the tone and budget.
            </p>
          </div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--silver-muted)]">
            {textPrompt.trim().length} chars
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {samplePrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSeedPrompt(prompt)}
              className="secondary-action min-h-[2.8rem] rounded-full px-4 text-left text-[0.84rem] font-medium"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button onClick={onBack} className="secondary-action sm:flex-1">
          Back
        </button>
        <button onClick={onSubmit} className="primary-action sm:flex-[1.5]">
          Get style audit
        </button>
      </div>
    </div>
  );
}

function LoadingStage() {
  return (
    <div className="flex h-full min-h-[560px] flex-col items-center justify-center">
      <div className="loading-core">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-silver-strong"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8.75 14.25c.75.8 1.83 1.25 3.25 1.25s2.5-.45 3.25-1.25" />
          <line x1="9.5" y1="10.25" x2="9.51" y2="10.25" />
          <line x1="14.5" y1="10.25" x2="14.51" y2="10.25" />
        </svg>
      </div>

      <p className="mt-8 text-xl font-semibold tracking-[-0.04em] text-silver-strong">
        Reading the fit.
      </p>
      <p className="mt-3 max-w-md text-center text-sm leading-7 text-[color:var(--foreground-soft)]">
        Archive is building the style audit first, then pulling live shopping
        pieces that actually match the direction.
      </p>

      <div className="mt-8 h-1.5 w-48 pulse-track" />

      <div className="mt-10 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="skeleton-card p-4">
            <div className="skeleton-line h-36 rounded-[20px]" />
            <div className="mt-4 space-y-3">
              <div className="skeleton-line w-2/5" />
              <div className="skeleton-line w-full" />
              <div className="skeleton-line w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultStage({
  audit,
  onReset,
  products,
  productsLoading,
  productSearchProgress,
}: {
  audit: StyleAudit;
  onReset: () => void;
  products: Product[];
  productsLoading: boolean;
  productSearchProgress: ProductSearchProgressEvent | null;
}) {
  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="section-label">Audit + Picks</p>
          <p className="mt-2 text-sm leading-7 text-[color:var(--foreground-soft)]">
            The audit holds the strategy. The shopping grid holds the next move.
          </p>
        </div>
        <button onClick={onReset} className="secondary-action">
          Try another look
        </button>
      </div>

      <AuditCard audit={audit} />

      <section className="grid gap-4">
        <div className="liquid-tile p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="section-label">Shopping Picks</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-silver-strong">
                Pieces that reinforce the read.
              </h3>
            </div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--silver-muted)]">
              {productsLoading ? "searching live" : `${products.length} items`}
            </p>
          </div>
        </div>

        {productsLoading ? (
          <ProductsLoadingState progress={productSearchProgress} />
        ) : products.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onClickTrack={(clickedProduct) => {
                  console.log(
                    "[archive] product_click",
                    clickedProduct.id,
                    clickedProduct.title
                  );
                }}
              />
            ))}
          </div>
        ) : (
          <div className="liquid-tile grid min-h-[280px] place-items-center p-8 text-center">
            <div className="max-w-sm">
              <p className="section-label">No Matches</p>
              <p className="mt-3 text-xl font-semibold tracking-[-0.04em] text-silver-strong">
                Live search came back light this round.
              </p>
              <p className="mt-3 text-sm leading-7 text-[color:var(--foreground-soft)]">
                Try tightening the occasion, budget, or silhouette so the next
                pass has a stronger search signal.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ProductsLoadingState({
  progress,
}: {
  progress: ProductSearchProgressEvent | null;
}) {
  const reportedStageIndex = productSearchStages.findIndex(
    (stage) => stage.id === progress?.stage
  );
  const activeStageIndex = reportedStageIndex >= 0 ? reportedStageIndex : 0;
  const baseStage = productSearchStages[activeStageIndex];
  const activeStage = {
    ...baseStage,
    detail: progress?.detail || baseStage.detail,
  };

  return (
    <div className="grid gap-4">
      <div className="product-search-panel liquid-tile p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(280px,1fr)] lg:items-center">
          <div className="product-search-visual-wrap">
            <ProductSearchVisual stage={activeStage.id} />
          </div>

          <div>
            <p className="section-label">{activeStage.stat}</p>
            <h4 className="mt-3 text-2xl font-semibold text-silver-strong">
              {activeStage.label}
            </h4>
            <p className="mt-3 text-sm leading-7 text-[color:var(--foreground-soft)]">
              {activeStage.detail}
            </p>

            <div className="mt-6 grid gap-2">
              {productSearchStages.map((stage, index) => {
                const isActive = index === activeStageIndex;
                const isComplete =
                  index < activeStageIndex ||
                  (isActive && progress?.status === "complete");

                return (
                  <div
                    key={stage.id}
                    className={`product-search-step ${
                      isActive ? "is-active" : ""
                    } ${isComplete ? "is-complete" : ""}`}
                  >
                    <span className="product-search-step-marker" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-silver-strong">
                        {stage.label}
                      </p>
                      <p className="mt-1 truncate text-xs text-[color:var(--silver-muted)]">
                        {stage.stat}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="skeleton-card p-4">
            <div className="skeleton-line h-56 rounded-[22px]" />
            <div className="mt-4 space-y-3">
              <div className="skeleton-line w-1/3" />
              <div className="skeleton-line w-full" />
              <div className="skeleton-line w-4/5" />
              <div className="skeleton-line w-2/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductSearchVisual({ stage }: { stage: ProductSearchStageId }) {
  if (stage === "discovery") {
    return (
      <svg
        role="img"
        aria-label="Live product discovery animation"
        viewBox="0 0 240 180"
        className="product-search-visual"
      >
        <rect x="32" y="38" width="68" height="86" rx="12" className="search-card search-float" />
        <rect x="136" y="58" width="68" height="86" rx="12" className="search-card search-float-delay" />
        <path d="M100 74 C122 44 142 52 158 76" className="search-line search-dash" />
        <path d="M94 108 C122 140 148 132 166 116" className="search-line search-dash-delay" />
        <circle cx="66" cy="68" r="14" className="search-dot search-pulse" />
        <circle cx="170" cy="92" r="14" className="search-dot search-pulse-delay" />
        <path d="M56 99h32M56 111h24M160 122h28M160 134h20" className="search-ink" />
      </svg>
    );
  }

  if (stage === "vetting") {
    return (
      <svg
        role="img"
        aria-label="Product page vetting animation"
        viewBox="0 0 240 180"
        className="product-search-visual"
      >
        <rect x="42" y="30" width="156" height="120" rx="16" className="search-card" />
        <rect x="58" y="48" width="52" height="64" rx="10" className="search-photo" />
        <path d="M126 58h46M126 76h34M126 96h52M126 116h28" className="search-ink" />
        <path d="M58 132h124" className="search-line" />
        <path d="M70 128l9 9 18-21" className="search-check search-check-one" />
        <path d="M128 128l9 9 18-21" className="search-check search-check-two" />
        <path d="M34 46h172" className="search-sweep" />
      </svg>
    );
  }

  if (stage === "fallback") {
    return (
      <svg
        role="img"
        aria-label="Final product grid balancing animation"
        viewBox="0 0 240 180"
        className="product-search-visual"
      >
        <rect x="44" y="38" width="54" height="72" rx="12" className="search-card search-float" />
        <rect x="102" y="58" width="54" height="72" rx="12" className="search-card search-float-delay" />
        <rect x="160" y="42" width="36" height="58" rx="10" className="search-card search-soft-card" />
        <path d="M58 124h126" className="search-line" />
        <path d="M72 124v18M130 124v18M178 124v18" className="search-line" />
        <circle cx="72" cy="146" r="7" className="search-dot search-pulse" />
        <circle cx="130" cy="146" r="7" className="search-dot search-pulse-delay" />
        <circle cx="178" cy="146" r="7" className="search-dot search-pulse-late" />
      </svg>
    );
  }

  return (
    <svg
      role="img"
      aria-label="Audit intent reading animation"
      viewBox="0 0 240 180"
      className="product-search-visual"
    >
      <rect x="54" y="30" width="96" height="126" rx="16" className="search-card search-float" />
      <path d="M76 58h50M76 76h38M76 94h56M76 112h42" className="search-ink" />
      <circle cx="158" cy="118" r="28" className="search-lens" />
      <path d="M178 138l24 24" className="search-line search-handle" />
      <path d="M62 86h92" className="search-sweep" />
      <path d="M158 108l9 9 17-22" className="search-check search-check-one" />
    </svg>
  );
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="liquid-tile p-4">
      <label htmlFor={id} className="section-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-surface mt-3 min-h-[3.4rem]"
      />
    </div>
  );
}

function SignalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="liquid-tile flex items-center justify-between gap-3 px-4 py-3.5">
      <p className="section-label">{label}</p>
      <p className="max-w-[60%] truncate text-right text-sm font-medium text-silver-strong">
        {value}
      </p>
    </div>
  );
}
