type LoadingStateProps = {
  title?: string;
  description?: string;
  progress?: number;
};

export function LoadingState({ title = "Processing...", description, progress }: LoadingStateProps) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-steel-200 bg-white px-6 py-16 text-center shadow-panel">
      {/* Single clean spinner */}
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-steel-200 border-t-accent-500" />
      </div>
      <h3 className="mt-5 text-base font-semibold text-steel-900">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-steel-500">{description}</p>
      ) : null}
      {progress !== undefined ? (
        <div className="mt-4 h-1 w-48 overflow-hidden rounded-full bg-steel-100">
          <div
            className="h-full rounded-full bg-accent-500 transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      ) : (
        <div className="mt-4 h-1 w-48 overflow-hidden rounded-full bg-steel-100">
          <div className="h-full w-full animate-shimmer rounded-full" />
        </div>
      )}
    </div>
  );
}

export function InlineSpinner({ size = 16 }: { size?: number }) {
  return (
    <div
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
      style={{ width: size, height: size }}
    />
  );
}
