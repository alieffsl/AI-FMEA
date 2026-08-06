import { useCallback, useEffect, useRef, useState } from "react";
import { WandSparkles, Download, FileText, FileSpreadsheet, Copy, AlertTriangle, CheckCircle2, FileDown, Database, X } from "lucide-react";
import type { ProjectMetadata, ToolRow, ToolImage, DraftScope } from "./types/project";
import type { FmeaDraftRow } from "./types/fmea";
import { parseCdiFile, convertLegacyToolInput } from "./services/cdiParser";
import { generateFmea } from "./services/fmeaGenerator";
import { exportCsv, exportJson, exportExcel, copyFmeaToClipboard } from "./services/exportService";
import { saveDraft, loadDraft } from "./services/draftStore";
import { validateCdiFile } from "./lib/validation";
import { fetchJson } from "./lib/http";
import { AppShell, type AppView } from "./components/layout/AppShell";
import { CdiUploadPanel } from "./components/CdiUploadPanel";
import { ProjectSummaryCard } from "./components/ProjectSummaryCard";
import { ToolingTable } from "./components/ToolingTable";
import { FmeaDraftTable } from "./components/FmeaDraftTable";
import { LoadingState } from "./components/ui/LoadingState";
import { EmptyState } from "./components/ui/EmptyState";

// Legacy imports for demo mode and secondary views
import { cdiNewTools, cdiProject } from "./data/cdiMockData";
import { OverviewDashboard, type DashboardStats } from "./components/dashboard/OverviewDashboard";
import { MecProductStandards } from "./components/standards/MecProductStandards";

export default function App() {
  // Read initial view from URL path (e.g., /knowledge or /dashboard)
  const getInitialView = (): AppView => {
    const path = window.location.pathname.slice(1); // Remove leading '/'
    const validViews: AppView[] = ['generate', 'dashboard', 'knowledge', 'review', 'export'];
    if (path === 'standards' || path === 'product-standards') return 'knowledge';
    return validViews.includes(path as AppView) ? (path as AppView) : 'generate';
  };

  const [activeView, setActiveView] = useState<AppView>(getInitialView());
  const [initialKnowledgeSection] = useState<"product-standards" | "history">(() =>
    window.location.pathname === "/knowledge" ? "history" : "product-standards",
  );

  // ── CDI / Project state ──
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [toolRows, setToolRows] = useState<ToolRow[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // ── FMEA generation state ──
  const [fmeaRows, setFmeaRows] = useState<FmeaDraftRow[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<DraftScope>("all");

  // ── Export state ──
  const [copied, setCopied] = useState(false);

  // ── Draft persistence state ──
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // ── Dashboard / Live Data State ──
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [dashboardState, setDashboardState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Update URL path when view changes.
  // Skips the first run: the URL already matches the initial view, so pushing
  // it again added a spurious history entry before the user did anything. Query
  // params are dropped because they belong to the view that set them (the
  // knowledge base writes ?page=N, which is meaningless on /dashboard).
  const previousViewRef = useRef<AppView>(activeView);
  useEffect(() => {
    // Comparing the value is Strict Mode-safe. A one-time `didMount` flag is
    // not: React replays mount effects in development while preserving refs,
    // which made the replay strip `?draft=<id>` before restore could read it.
    if (previousViewRef.current === activeView) return;
    previousViewRef.current = activeView;
    window.history.pushState(null, '', `/${activeView}`);
  }, [activeView]);

  // Listen for popstate (browser back/forward)
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.slice(1);
      const validViews: AppView[] = ['generate', 'dashboard', 'knowledge', 'review', 'export'];
      if (path === 'standards' || path === 'product-standards') {
        setActiveView('knowledge');
      } else if (validViews.includes(path as AppView)) {
        setActiveView(path as AppView);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Restore a saved draft when the URL carries ?draft=<id>, so a refresh or a
  // shared link brings the generated draft back instead of losing it.
  const initialDraftIdRef = useRef(
    new URLSearchParams(window.location.search).get('draft'),
  );
  useEffect(() => {
    // Capture this during render so Strict Mode's effect replay cannot observe
    // a URL changed by another mount effect.
    const draftId = initialDraftIdRef.current;
    if (!draftId) return;

    let cancelled = false;
    const restoreWatchdog = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setIsRestoring(false);
      setRestoreError(
        "The saved draft did not finish loading. Check that the API is running, then reload or start a new draft.",
      );
    }, 15000);

    setIsRestoring(true);
    setRestoreError(null);

    loadDraft(draftId)
      .then((draft) => {
        if (cancelled) return;
        setFmeaRows(draft.drafts);
        setMetadata(draft.metadata);
        setSavedDraftId(draft.id);
        setSaveState("saved");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Surfaced through its own state: the upload screen does not render
        // generateError, so a failed restore would otherwise look like a
        // normal empty start with no explanation.
        setRestoreError(
          err instanceof Error ? err.message : "Could not restore the saved draft.",
        );
      })
      .finally(() => {
        window.clearTimeout(restoreWatchdog);
        if (!cancelled) setIsRestoring(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(restoreWatchdog);
    };
  }, []);

  // Fetch dashboard data only when the dashboard is actually opened, and only
  // once. This used to run on every app start regardless of view, so everyone
  // who just wanted to upload a CDI file still paid for an unbounded query over
  // the whole knowledge base before the page settled.
  //
  // The "already started" guard is a ref, not state. Keeping `dashboardState`
  // in the dependency list while the effect also *set* it made the effect
  // re-run, and its own cleanup then cancelled the in-flight request, so the
  // dashboard sat on the loading state forever.
  const dashboardRequestedRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    dashboardRequestedRef.current = true;
    setDashboardState("loading");
    setDashboardError(null);

    try {
      const data = await fetchJson<DashboardStats>('/api/dashboard/stats');
      setDashboardStats(data);
      setDashboardState("ready");
    } catch (err) {
      console.error('[Dashboard] Failed to fetch live stats:', err);
      setDashboardError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
      setDashboardState("error");
    }
  }, []);

  useEffect(() => {
    if (activeView !== "dashboard" || dashboardRequestedRef.current) return;
    void loadDashboard();
  }, [activeView, loadDashboard]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CDI Upload handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleFileSelected = useCallback(async (file: File) => {
    const validationError = validateCdiFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setFmeaRows([]);
    setGenerateError(null);

    try {
      const result = await parseCdiFile(file);
      setMetadata(result.metadata);
      setToolRows(result.toolRows);
      setParseWarnings(result.warnings);
      setUploadError(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to parse the CDI file.");
      setMetadata(null);
      setToolRows([]);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleLoadDemo = useCallback(() => {
    const demoMetadata: ProjectMetadata = {
      projectName: `${cdiProject.projectCode} — ${cdiProject.toyName}`,
      sourceFilename: cdiProject.sourceWorkbook,
      toolMaker: cdiProject.toolMaker,
      vendor: cdiProject.manufacturingVendor,
      quoteType: cdiProject.quoteType,
      toyYear: cdiProject.toyYear,
      revision: cdiProject.revision,
      toolPlan: cdiProject.totalMolds,
      setCount: "",
      leadTimeDays: cdiProject.toolingLeadTimeDays,
    };

    const demoRows = cdiNewTools.map((t) => convertLegacyToolInput(t));

    setMetadata(demoMetadata);
    setToolRows(demoRows);
    setParseWarnings(["Demo data loaded. Upload a real CDI file to replace."]);
    setUploadError(null);
    setFmeaRows([]);
    setGenerateError(null);
  }, []);

  const handleReset = useCallback(() => {
    // Release attachment object URLs. Only per-image removal used to revoke
    // them, so resetting or re-uploading leaked every thumbnail for the life of
    // the tab. Done here rather than inside the state updater, which React
    // may invoke more than once.
    for (const row of toolRows) {
      for (const image of row.images) URL.revokeObjectURL(image.thumbnailUrl);
    }

    setToolRows([]);
    setMetadata(null);
    setParseWarnings([]);
    setUploadError(null);
    setFmeaRows([]);
    setGenerateError(null);
    setSavedDraftId(null);
    setSaveState("idle");
    setSaveError(null);
  }, [toolRows]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Tool row handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleToggleSelect = useCallback((id: string) => {
    setToolRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)),
    );
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setToolRows((prev) => {
      const allSelected = prev.every((r) => r.selected);
      return prev.map((r) => ({ ...r, selected: !allSelected }));
    });
  }, []);

  const handleImagesChange = useCallback((toolRowId: string, images: ToolImage[]) => {
    setToolRows((prev) =>
      prev.map((r) => (r.id === toolRowId ? { ...r, images } : r)),
    );
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // FMEA Generation
  // ═══════════════════════════════════════════════════════════════════════════

  function getSelectedRows(): ToolRow[] {
    switch (draftScope) {
      case "selected":
        return toolRows.filter((r) => r.selected);
      case "with-images":
        return toolRows.filter((r) => r.images.length > 0);
      case "without-draft":
        return toolRows.filter((r) => r.draftStatus !== "generated");
      default:
        return toolRows;
    }
  }

  async function handleGenerate() {
    if (!metadata) return;
    const selected = getSelectedRows();
    if (selected.length === 0) return;

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const result = await generateFmea(selected, metadata);
      setFmeaRows(result.drafts);

      // Update metadata if server returned it (this ensures metadata cards are populated)
      if (result.metadata) {
        console.info('[App] Updating metadata from server response:', result.metadata);
        setMetadata((prev) => ({
          ...prev!,
          ...result.metadata
        }));
      }

      // Update draft status on tool rows.
      // Matched on the row id the server echoes back, not on the description:
      // descriptions are normalized server-side, so comparing them here marked
      // the wrong rows. A row whose only result is the "No historical data"
      // placeholder is reported separately so it is not mistaken for a draft.
      const evidenceByRowId = new Map<string, boolean>();
      for (const draft of result.drafts) {
        const hasEvidence = draft.hasEvidence !== false;
        evidenceByRowId.set(draft.toolRowId, (evidenceByRowId.get(draft.toolRowId) ?? false) || hasEvidence);
      }

      setToolRows((prev) =>
        prev.map((r) => {
          if (!evidenceByRowId.has(r.id)) return r;
          return {
            ...r,
            draftStatus: evidenceByRowId.get(r.id) ? ("generated" as const) : ("no-evidence" as const),
          };
        }),
      );

      // Autosave. A failure here must not discard the draft the user is
      // looking at, so it is reported separately from generation itself.
      setSaveState("saving");
      setSaveError(null);
      try {
        const draftId = await saveDraft(
          { ...metadata, ...(result.metadata ?? {}) },
          result.drafts,
          savedDraftId,
        );
        setSavedDraftId(draftId);
        setSaveState("saved");

        const params = new URLSearchParams(window.location.search);
        params.set("draft", draftId);
        window.history.replaceState(null, "", `/${activeView}?${params.toString()}`);
      } catch (err) {
        setSaveState("error");
        setSaveError(
          err instanceof Error ? err.message : "The draft was generated but could not be saved.",
        );
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "FMEA generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FMEA Row handlers
  // ═══════════════════════════════════════════════════════════════════════════

  function handleFmeaEditRow(id: string, updates: Partial<FmeaDraftRow>) {
    setFmeaRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Export handlers
  // ═══════════════════════════════════════════════════════════════════════════

  function handleExportExcel() {
    if (metadata && fmeaRows.length) exportExcel(fmeaRows, metadata, toolRows);
  }

  function handleExportCsv() {
    if (metadata && fmeaRows.length) exportCsv(fmeaRows, metadata);
  }

  function handleExportJson() {
    if (metadata && fmeaRows.length) exportJson(fmeaRows, metadata, toolRows);
  }

  async function handleCopy() {
    if (fmeaRows.length) {
      await copyFmeaToClipboard(fmeaRows);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  function renderGenerateView() {
    // ── Restoring a saved draft ──
    if (isRestoring) {
      return (
        <div className="mx-auto max-w-4xl py-10">
          <LoadingState
            title="Restoring saved draft..."
            description="Loading the stored FMEA rows and project details."
          />
        </div>
      );
    }

    // ── Upload phase ──
    if (!metadata) {
      return (
        <div className="mx-auto max-w-4xl space-y-8 py-10">
          {restoreError ? (
            <div className="animate-fade-in flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="font-bold">Could not reopen the saved draft</p>
                <p className="mt-1">{restoreError}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRestoreError(null);
                  window.history.replaceState(null, "", `/${activeView}`);
                }}
                className="rounded-lg p-1.5 text-amber-500 transition hover:bg-amber-100 hover:text-amber-800"
                aria-label="Dismiss and start a new draft"
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          ) : null}
          <div className="text-center animate-slide-down">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent-500">AI FMEA Tooling</p>
            <h2 className="mt-2 text-2xl font-bold text-steel-900 tracking-tight">Generate Draft FMEA</h2>
            <p className="mt-2.5 text-sm text-steel-500 max-w-lg mx-auto">
              Upload a CDI Excel file to parse tool rows and generate evidence-based failure mode drafts.
            </p>
          </div>
          <CdiUploadPanel
            onFileSelected={handleFileSelected}
            isLoading={isUploading}
            error={uploadError}
            onDismissError={() => setUploadError(null)}
            onLoadDemo={handleLoadDemo}
          />
        </div>
      );
    }

    // ── Main workflow ──
    const selectedRows = getSelectedRows();
    const canGenerate = selectedRows.length > 0 && !isGenerating;

    return (
      <div className="space-y-8 pb-32">
        {/* Project summary */}
        <ProjectSummaryCard metadata={metadata} toolRows={toolRows} onReset={handleReset} />

        {/* Warnings */}
        {parseWarnings.length > 0 ? (
          <div className="animate-fade-in flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              {parseWarnings.map((w) => (
                <p key={w} className="font-medium">{w}</p>
              ))}
            </div>
          </div>
        ) : null}

        {/* Tooling table */}
        <ToolingTable
          toolRows={toolRows}
          onToggleSelect={handleToggleSelect}
          onToggleSelectAll={handleToggleSelectAll}
          onImagesChange={handleImagesChange}
        />

        {/* Save status — persistence is otherwise invisible to the user */}
        {saveState === "saved" && savedDraftId ? (
          <div className="animate-fade-in flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-sm">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
            <div>
              <p className="font-bold">Draft saved</p>
              <p className="mt-1">
                This draft is stored and will still be here if you refresh or return later.
                Keep the current link to reopen it.
              </p>
            </div>
          </div>
        ) : null}

        {saveState === "error" ? (
          <div className="animate-fade-in flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              <p className="font-bold">Draft generated but not saved</p>
              <p className="mt-1">
                {saveError} Export the draft before leaving this page, or it will be lost.
              </p>
            </div>
          </div>
        ) : null}

        {/* Generation loading */}
        {isGenerating ? (
          <LoadingState
            title="Generating AI Draft FMEA..."
            description={`Processing ${selectedRows.length} tool row${selectedRows.length !== 1 ? "s" : ""} against historical evidence and baseline standards.`}
          />
        ) : null}

        {/* Generation error */}
        {generateError ? (
          <div className="animate-fade-in flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" />
            <div>
              <p className="font-bold">Generation Failed</p>
              <p className="mt-1">{generateError}</p>
            </div>
          </div>
        ) : null}

        {/* FMEA Results */}
        {fmeaRows.length > 0 && !isGenerating ? (
          <FmeaDraftTable
            rows={fmeaRows}
            onEditRow={handleFmeaEditRow}
          />
        ) : null}

        {/* Empty state for results */}
        {!isGenerating && fmeaRows.length === 0 && metadata ? (
          <EmptyState
            icon={<WandSparkles size={32} />}
            title="Ready to Generate"
            description="Select rows above and click 'Generate AI Draft FMEA' to create evidence-based failure mode suggestions. Only rows with matching historical evidence will produce results."
          />
        ) : null}

        {/* Generate action bar (Sticky bottom) */}
        <div className="fixed bottom-0 left-0 right-0 z-40 lg:left-[260px]">
          <div className="glass-panel border-t border-steel-200 px-4 py-3.5 sm:px-6 lg:px-8 shadow-panel-lg">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <select
                    value={draftScope}
                    onChange={(e) => setDraftScope(e.target.value as DraftScope)}
                    className="h-10 w-full appearance-none rounded-xl border border-steel-200 bg-white pl-4 pr-10 text-sm font-medium text-steel-700 outline-none transition-all duration-200 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 hover:border-steel-300"
                  >
                    <option value="all">All rows ({toolRows.length})</option>
                    <option value="selected">Selected ({toolRows.filter((r) => r.selected).length})</option>
                    <option value="with-images">With images ({toolRows.filter((r) => r.images.length > 0).length})</option>
                    <option value="without-draft">Without draft ({toolRows.filter((r) => r.draftStatus !== "generated").length})</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-steel-400">
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd" /></svg>
                  </div>
                </div>
                <span className="hidden font-mono text-xs text-steel-400 sm:inline-block">
                  {selectedRows.length} row{selectedRows.length !== 1 ? "s" : ""} to process
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold text-white transition-all duration-200 ${
                    canGenerate
                      ? "bg-accent-500 shadow-sm hover:bg-accent-600 hover:shadow-md active:scale-[0.97]"
                      : "bg-steel-300 cursor-not-allowed shadow-none"
                  }`}
                >
                  <WandSparkles size={16} />
                  {isGenerating ? "Generating..." : "Generate AI Draft"}
                </button>
              </div>
            </div>
            {!canGenerate && !isGenerating && selectedRows.length === 0 ? (
              <p className="mt-2 text-center text-[11px] font-semibold uppercase tracking-wider text-amber-500 sm:text-left max-w-7xl mx-auto">
                Select rows to enable generation
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderActiveView() {
    if (activeView === "generate") {
      return renderGenerateView();
    }

    if (activeView === "dashboard") {
      if (dashboardState === "loading" || dashboardState === "idle") {
        return (
          <LoadingState
            title="Loading dashboard..."
            description="Fetching historical FMEA cases from the knowledge base."
          />
        );
      }

      if (dashboardState === "error") {
        return (
          <EmptyState
            icon={<AlertTriangle size={32} />}
            title="Could not load the dashboard"
            description={dashboardError ?? "The dashboard data could not be fetched."}
            action={
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-accent-500 px-6 text-sm font-semibold text-white transition hover:bg-accent-600"
              >
                Retry
              </button>
            }
          />
        );
      }

      if (!dashboardStats || dashboardStats.totals.cases === 0) {
        return (
          <EmptyState
            title="No historical cases yet"
            description="The knowledge base returned no records, so there is nothing to chart."
          />
        );
      }

      return <OverviewDashboard stats={dashboardStats} />;
    }

    if (activeView === "knowledge") {
      return <div className="animate-fade-in"><MecProductStandards initialSection={initialKnowledgeSection} /></div>;
    }

    if (activeView === "review") {
      if (fmeaRows.length === 0) {
        return (
          <EmptyState
            icon={<WandSparkles size={32} />}
            title="No draft FMEA to review"
            description="Generate an AI Draft FMEA first, then come here to review and approve suggestions."
          />
        );
      }
      return (
        <FmeaDraftTable
          rows={fmeaRows}
          onEditRow={handleFmeaEditRow}
        />
      );
    }

    if (activeView === "export") {
      if (fmeaRows.length === 0) {
        return (
          <EmptyState
            icon={<Download size={32} />}
            title="No data to export"
            description="Generate an AI Draft FMEA first. Export options will be available after generation."
          />
        );
      }

      return (
        <div className="space-y-6 animate-slide-up">
          <div className="rounded-2xl border border-steel-200 bg-white p-8 shadow-panel">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50 text-accent-500">
                <FileDown size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-steel-900">Export Draft FMEA</h2>
                <p className="mt-1 text-sm text-steel-500">
                  <span className="font-semibold text-steel-700">{fmeaRows.length}</span> rows ready for export from <span className="font-semibold text-steel-700">{metadata?.projectName || "Unknown Project"}</span>
                </p>
              </div>
            </div>
            
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <button type="button" onClick={handleExportExcel} className="card-interactive flex flex-col items-center gap-3 rounded-xl border border-steel-200 bg-white p-6 text-steel-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">
                <FileSpreadsheet size={32} className="text-emerald-500" />
                <span className="font-bold">Excel (.xlsx)</span>
              </button>
              <button type="button" onClick={handleExportCsv} className="card-interactive flex flex-col items-center gap-3 rounded-xl border border-steel-200 bg-white p-6 text-steel-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">
                <FileText size={32} className="text-blue-500" />
                <span className="font-bold">CSV File</span>
              </button>
              <button type="button" onClick={handleExportJson} className="card-interactive flex flex-col items-center gap-3 rounded-xl border border-steel-200 bg-white p-6 text-steel-700 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700">
                <Database size={32} className="text-accent-500" />
                <span className="font-bold">JSON Data</span>
              </button>
              <button type="button" onClick={handleCopy} className="card-interactive flex flex-col items-center gap-3 rounded-xl border border-steel-200 bg-white p-6 text-steel-700 hover:border-steel-400 hover:bg-steel-50 hover:text-steel-900">
                <Copy size={32} className="text-steel-500" />
                <span className="font-bold">{copied ? "Copied!" : "Copy to Clipboard"}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <AppShell
      activeView={activeView}
      onNavigate={setActiveView}
      projectName={metadata?.projectName}
    >
      {renderActiveView()}
    </AppShell>
  );
}
