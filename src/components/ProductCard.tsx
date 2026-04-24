"use client";

import { useState } from "react";
import type { Product } from "@/lib/types";

interface ProductCardProps {
  product: Product;
  onClickTrack?: (product: Product) => void;
}

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function getProductSourceLabel(product: Product): string {
  switch (product.source) {
    case "live":
      return product.match_quality === "near"
        ? "Near live match"
        : "Live search result";
    case "catalog":
      return product.provider_label || "Local catalog fallback";
    case "affiliate":
      return product.provider_label || "Affiliate feed";
    case "ebay":
      return product.provider_label || "eBay marketplace";
    case "curated":
      return "Curated fallback";
    default:
      return product.provider_label || "Live search result";
  }
}

export default function ProductCard({
  product,
  onClickTrack,
}: ProductCardProps) {
  const [imgError, setImgError] = useState(false);
  const hasImage = Boolean(product.image_url) && !imgError;
  const sourceLabel = getProductSourceLabel(product);
  const missingPreferenceSummary =
    product.match_quality === "near" && product.missing_preferences?.length
      ? product.missing_preferences.slice(0, 2).join(", ")
      : null;

  return (
    <a
      href={product.product_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onClickTrack?.(product)}
      className="liquid-tile sheen-hover magnetic-lift group flex h-full flex-col overflow-hidden"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        {hasImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={product.image_url}
            alt={product.title}
            loading="lazy"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.035]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-white/[0.03]">
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-white/16"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}

        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,4,6,0.02)_0%,rgba(3,4,6,0.12)_38%,rgba(3,4,6,0.76)_100%)]" />

        <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--silver-strong)]">
            {product.brand}
          </span>
          <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--silver-strong)]">
            {priceFormatter.format(product.price)}
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--silver-strong)]/72">
            <span>{product.retailer}</span>
            <span>{product.category}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <p className="section-label">{sourceLabel}</p>
        <h4 className="mt-3 text-lg font-semibold leading-7 tracking-[-0.04em] text-silver-strong">
          {product.title}
        </h4>
        {missingPreferenceSummary ? (
          <p className="mt-2 text-xs leading-5 text-[color:var(--foreground-soft)]">
            Missing: {missingPreferenceSummary}
          </p>
        ) : null}

        <div className="mt-auto pt-5">
          <div className="flex items-center justify-between text-sm font-medium text-[color:var(--foreground-soft)] transition-colors duration-200 group-hover:text-silver-strong">
            <span>Open product</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </div>
        </div>
      </div>
    </a>
  );
}
