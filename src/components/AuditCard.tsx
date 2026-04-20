import type { ReactNode } from "react";
import type { StyleAudit } from "@/lib/types";

interface AuditCardProps {
  audit: StyleAudit;
}

const accentStyles = {
  works: {
    text: "text-[#f3f6ff]",
    icon: "text-[#f3f6ff]",
    dot: "bg-[#eef3ff]",
  },
  refine: {
    text: "text-[#ebdcc1]",
    icon: "text-[#ebdcc1]",
    dot: "bg-[#dcc29a]",
  },
  add: {
    text: "text-[#d8e5f8]",
    icon: "text-[#d8e5f8]",
    dot: "bg-[#c3d4ef]",
  },
} as const;

function ScoreBadge({ score }: { score: number }) {
  return (
    <div className="liquid-tile w-full max-w-[190px] p-5 sm:ml-auto">
      <p className="section-label">Score</p>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-4xl font-semibold tracking-[-0.06em] text-silver-strong">
          {score.toFixed(1)}
        </span>
        <span className="pb-1 text-sm text-[color:var(--silver-muted)]">/ 10</span>
      </div>
    </div>
  );
}

function AuditSection({
  className,
  icon,
  items,
  style,
  title,
}: {
  className?: string;
  icon: ReactNode;
  items: string[];
  style: (typeof accentStyles)[keyof typeof accentStyles];
  title: string;
}) {
  return (
    <section className={`liquid-tile h-full p-5 sm:p-6 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <span className={style.icon}>{icon}</span>
        <span
          className={`text-[0.76rem] font-semibold uppercase tracking-[0.16em] ${style.text}`}
        >
          {title}
        </span>
      </div>

      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <span className={`mt-[0.6rem] h-1.5 w-1.5 rounded-full ${style.dot}`} />
            <span className="text-sm leading-7 text-[color:var(--foreground-soft)]">
              {item}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AuditCard({ audit }: AuditCardProps) {
  return (
    <div className="grid gap-4">
      <section className="liquid-tile p-6 sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_190px]">
          <div>
            <p className="section-label">Overall Take</p>
            <p className="mt-3 max-w-4xl text-[1.22rem] leading-8 tracking-[-0.03em] text-silver-strong sm:text-[1.52rem] sm:leading-9">
              {audit.summary}
            </p>

            <div className="mt-5 border-t border-white/8 pt-4">
              <p className="section-label">Aesthetic Read</p>
              <p className="mt-2 text-base tracking-[-0.02em] text-[color:var(--foreground-soft)] sm:text-[1.05rem]">
                {audit.aesthetic_read}
              </p>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--silver-muted)]">
                {audit.tone && <span>{audit.tone}</span>}
              {audit.recommended_categories.slice(0, 2).map((category) => (
                  <span key={category}>{category}</span>
              ))}
              </div>
            </div>
          </div>

          <ScoreBadge score={audit.score} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <AuditSection
          title="What lands"
          items={audit.what_works}
          style={accentStyles.works}
          icon={
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
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        />

        <AuditSection
          title="Refine"
          items={audit.what_to_fix}
          style={accentStyles.refine}
          icon={
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
              <path d="M12 3v12" />
              <path d="M8 11l4 4 4-4" />
              <path d="M5 21h14" />
            </svg>
          }
        />

        <AuditSection
          title="Add next"
          items={audit.missing_pieces}
          style={accentStyles.add}
          className="xl:col-span-2"
          icon={
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
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
