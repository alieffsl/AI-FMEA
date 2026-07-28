import { getRpnBucket } from "../../lib/normalization";

const badgeBase = "inline-flex min-w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors duration-150";

export type DraftStatus = "draft" | "approved" | "rejected" | "edited";

export function StatusBadge({ status }: { status: DraftStatus | string }) {
  const styles: Record<string, { bg: string; text: string; dot: string }> = {
    draft:     { bg: "bg-slate-100",   text: "text-slate-700",   dot: "bg-slate-400" },
    approved:  { bg: "bg-emerald-50",  text: "text-emerald-800", dot: "bg-emerald-500" },
    rejected:  { bg: "bg-red-50",      text: "text-red-800",     dot: "bg-red-500" },
    edited:    { bg: "bg-blue-50",     text: "text-blue-800",    dot: "bg-blue-500" },
    pending:   { bg: "bg-slate-100",   text: "text-slate-500",   dot: "bg-slate-300" },
    generating:{ bg: "bg-amber-50",    text: "text-amber-800",   dot: "bg-amber-500" },
    generated: { bg: "bg-emerald-50",  text: "text-emerald-800", dot: "bg-emerald-500" },
    error:     { bg: "bg-red-50",      text: "text-red-800",     dot: "bg-red-500" },
    "Needs Engineer Review": { bg: "bg-amber-50",  text: "text-amber-900", dot: "bg-amber-500" },
    Draft:     { bg: "bg-slate-100",   text: "text-slate-700",   dot: "bg-slate-400" },
    Accepted:  { bg: "bg-emerald-50",  text: "text-emerald-800", dot: "bg-emerald-500" },
    Rejected:  { bg: "bg-red-50",      text: "text-red-800",     dot: "bg-red-500" },
    Open:      { bg: "bg-blue-50",     text: "text-blue-800",    dot: "bg-blue-500" },
    "Close FS":{ bg: "bg-green-50",    text: "text-green-800",   dot: "bg-green-500" },
    "Close NS":{ bg: "bg-teal-50",     text: "text-teal-800",    dot: "bg-teal-500" },
  };

  const s = styles[status] ?? { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400" };
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span className={`${badgeBase} ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {label}
    </span>
  );
}

export function RiskBadge({ rpn }: { rpn: number }) {
  const bucket = getRpnBucket(rpn);
  const styles: Record<typeof bucket, { bg: string; text: string; dot: string }> = {
    Critical: { bg: "bg-red-50",     text: "text-red-800",     dot: "bg-red-500" },
    High:     { bg: "bg-orange-50",  text: "text-orange-800",  dot: "bg-orange-500" },
    Medium:   { bg: "bg-amber-50",   text: "text-amber-800",   dot: "bg-amber-500" },
    Low:      { bg: "bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-500" },
  };

  const s = styles[bucket];
  return (
    <span className={`${badgeBase} ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {bucket}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: "High" | "Medium" | "Low" }) {
  const styles = {
    High:   { bg: "bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-500" },
    Medium: { bg: "bg-blue-50",    text: "text-blue-800",    dot: "bg-blue-500" },
    Low:    { bg: "bg-slate-100",  text: "text-slate-700",   dot: "bg-slate-400" },
  };

  const s = styles[confidence];
  return (
    <span className={`${badgeBase} ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {confidence}
    </span>
  );
}
