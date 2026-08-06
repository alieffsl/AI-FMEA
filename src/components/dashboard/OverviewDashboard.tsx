import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
  Line,
  LabelList,
  Legend,
} from "recharts";
import {
  X,
} from "lucide-react";
import { getRpnBucket } from "../../lib/normalization";
import { fetchJson } from "../../lib/http";
import { RiskBadge, StatusBadge } from "../ui/StatusBadge"; // Note: Updated import path

/** A drill-down row, fetched on demand from /api/dashboard/cases. */
export type DashboardCase = {
  id: string;
  projectCode: string | null;
  projectName: string | null;
  toolNo: string;
  toolDescription: string;
  normalizedFamily: string;
  material: string;
  gateType: string;
  failure: string;
  recommendation: string;
  severity: number;
  occurrence: number;
  detection: number;
  rpn: number;
  status: string;
  loggedAt: string | null;
};

/** Pre-aggregated counts from /api/dashboard/stats. */
export type DashboardStats = {
  totals: { cases: number; tools: number; failureModes: number };
  failureFrequency: Array<{ name: string; count: number }>;
  partGroups: Array<{ name: string; count: number; failureTypes: number }>;
  riskDistribution: Array<{ name: string; count: number }>;
  statusMix: Array<{ name: string; count: number }>;
  materialGate: Array<{ key: string; count: number }>;
};

/** Which dashboard segment a drill-down is showing. */
type Dimension = "failure" | "family" | "risk" | "status" | "materialGate";

type OverviewDashboardProps = {
  stats: DashboardStats;
};

const bucketColors: Record<string, string> = {
  Low: "#10b981",
  Medium: "#f59e0b",
  High: "#f97316",
  Critical: "#ef4444",
};

// Updated status colors to match the industrial-refined palette
const statusColors = ["#1a73e8", "#10b981", "#f59e0b", "#a152f9", "#0ea5e9", "#ef6c85"];

type DrilldownState = {
  title: string;
  dimension: Dimension;
  value: string;
  /** Rows for the current page only; the full set stays in the database. */
  rows: DashboardCase[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  expandedCaseId: string | null;
  caseDetails: Record<string, any>;
} | null;

type ChartClickPayload = {
  name?: string;
  payload?: {
    name?: string;
  };
};

function getChartName(data: ChartClickPayload | undefined): string {
  return data?.payload?.name ?? data?.name ?? "";
}

function DrilldownDrawer({
  drilldown,
  onClose,
  onUpdate,
  onPage,
}: {
  drilldown: DrilldownState;
  onClose: () => void;
  onUpdate: (update: Partial<NonNullable<DrilldownState>>) => void;
  onPage: (page: number) => void;
}) {
  if (!drilldown) return null;

  // Scoped to the loaded page, and labelled as such: the full result set now
  // lives in the database rather than in memory.
  const openCount = drilldown.rows.filter((item) => item.status === "Open").length;
  const criticalCount = drilldown.rows.filter((item) => getRpnBucket(item.rpn) === "Critical").length;

  async function toggleCaseDetails(caseId: string) {
    const currentDrilldown = drilldown;
    if (!currentDrilldown) return;

    if (currentDrilldown.expandedCaseId === caseId) {
      onUpdate({ expandedCaseId: null });
      return;
    }

    onUpdate({ expandedCaseId: caseId });
    
    if (!currentDrilldown.caseDetails[caseId]) {
      try {
        const details = await fetchJson<Record<string, unknown>>(
          `/api/dashboard/case/${caseId}/details`,
        );
        onUpdate({ caseDetails: { ...currentDrilldown.caseDetails, [caseId]: details } });
      } catch (error) {
        console.error('Failed to fetch case details:', error);
        // Recorded against the case so the expanded panel can say something,
        // rather than silently staying blank forever.
        onUpdate({
          caseDetails: {
            ...currentDrilldown.caseDetails,
            [caseId]: {
              loadError: error instanceof Error ? error.message : 'Could not load case history.',
            },
          },
        });
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close drilldown overlay"
        className="absolute inset-0 animate-fade-in bg-steel-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <section className="animate-slide-up relative z-10 flex max-h-[88vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-2xl bg-white dark:bg-steel-900 dark:border-steel-700 shadow-xl shadow-steel-900/20">
        <header className="accent-bar-top flex items-start justify-between gap-4 border-b border-steel-200 bg-steel-50/50 p-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-accent-500">AI FMEA Drill-down</p>
            <h2 className="mt-1.5 text-xl font-bold text-steel-900">{drilldown.title}</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="flex items-center gap-1.5 rounded-full bg-steel-100 px-3 py-1 text-steel-700">
                <span className="h-1.5 w-1.5 rounded-full bg-steel-400" />
                {drilldown.total.toLocaleString()} evidence rows
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {openCount} open on this page
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-red-700">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {criticalCount} critical on this page
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-steel-400 hover:bg-steel-200 hover:text-steel-700 transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="compact-scrollbar flex-1 overflow-y-auto p-5">
          {drilldown.loading ? (
            <div className="p-12 text-center text-sm text-steel-500">Loading evidence rows...</div>
          ) : drilldown.error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="text-sm font-semibold text-red-800">Could not load these rows</p>
              <p className="mt-1 text-sm text-red-700">{drilldown.error}</p>
              <button
                type="button"
                onClick={() => onPage(drilldown.page)}
                className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          ) : drilldown.rows.length ? (
            <div className="grid gap-3">
              {drilldown.rows.map((item) => {
                const logDate = item.loggedAt ? new Date(item.loggedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : null;
                const isExpanded = drilldown.expandedCaseId === item.id;
                const details = drilldown.caseDetails[item.id];
                
                return (
                <article key={item.id} className="rounded-xl border border-steel-200 bg-white dark:bg-steel-900 dark:border-steel-700 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCaseDetails(item.id)}
                    className="w-full p-5 text-left hover:bg-steel-50 transition"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {logDate && (
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">
                              {logDate}
                            </span>
                          )}
                          <StatusBadge status={item.status} />
                        </div>
                        <h3 className="mt-3 text-base font-bold text-steel-900">{item.failure}</h3>
                        <p className="mt-1 text-sm text-steel-500">
                          {item.projectCode} / {item.toolNo} / {item.toolDescription}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-lg bg-steel-50 px-2.5 py-1.5 font-mono text-sm font-semibold text-steel-600 tabular-nums">
                          S/O/D {item.severity}/{item.occurrence}/{item.detection}
                        </span>
                        <span className="rounded-lg bg-steel-50 px-2.5 py-1.5 font-mono text-sm font-bold text-steel-900 tabular-nums border border-steel-100">
                          RPN {item.rpn}
                        </span>
                        <RiskBadge rpn={item.rpn} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-accent-600">
                      <span>{isExpanded ? '▼' : '▶'}</span>
                      <span>{isExpanded ? 'Hide' : 'Show'} detailed history</span>
                    </div>
                  </button>
                  
                  {isExpanded && details?.loadError && (
                    <div className="border-t border-steel-200 bg-red-50 p-5 text-sm text-red-800">
                      {String(details.loadError)}
                    </div>
                  )}

                  {isExpanded && details && !details.loadError && (
                    <div className="border-t border-steel-200 bg-steel-50/50 p-5 space-y-5">
                      {/* Potential Failure / Recommendation Actions */}
                      {details.recommendations && details.recommendations.length > 0 && (
                        <div>
                          <h4 className="text-sm font-bold text-steel-900 mb-3">Recommendation Actions</h4>
                          <div className="space-y-2">
                            {details.recommendations.map((rec: any) => {
                              const date = rec.inputDate ? new Date(rec.inputDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
                              return (
                                <div key={rec.id} className="rounded-lg border border-steel-200 bg-white p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-steel-900 text-sm">{rec.inputBy}:</span>
                                    <span className="text-xs text-steel-500">{date}</span>
                                  </div>
                                  <p className="text-sm text-steel-700">{rec.text}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* First Shot */}
                      {details.firstShot && details.firstShot.length > 0 && (
                        <div>
                          <h4 className="text-sm font-bold text-steel-900 mb-3">First Shot</h4>
                          <div className="space-y-2">
                            {details.firstShot.map((fs: any) => {
                              const date = fs.inputDate ? new Date(fs.inputDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
                              return (
                                <div key={fs.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-amber-900 text-sm">{fs.inputBy}:</span>
                                    <span className="text-xs text-amber-600">{date}</span>
                                  </div>
                                  <p className="text-sm text-amber-900">{fs.text}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* First Shot Actions */}
                      {details.firstShotActions && details.firstShotActions.length > 0 && (
                        <div>
                          <h4 className="text-sm font-bold text-steel-900 mb-3">Recommendation Actions (First Shot)</h4>
                          <div className="space-y-2">
                            {details.firstShotActions.map((action: any) => {
                              const date = action.inputDate ? new Date(action.inputDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
                              return (
                                <div key={action.id} className="rounded-lg border border-steel-200 bg-white p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-steel-900 text-sm">{action.inputBy}:</span>
                                    <span className="text-xs text-steel-500">{date}</span>
                                  </div>
                                  <p className="text-sm text-steel-700">{action.text}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Next Shot */}
                      {details.nextShot && details.nextShot.length > 0 && (
                        <div>
                          <h4 className="text-sm font-bold text-steel-900 mb-3">Next Shot</h4>
                          <div className="space-y-2">
                            {details.nextShot.map((ns: any) => {
                              const date = ns.inputDate ? new Date(ns.inputDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
                              return (
                                <div key={ns.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-emerald-900 text-sm">{ns.inputBy}:</span>
                                    <span className="text-xs text-emerald-600">{date}</span>
                                  </div>
                                  <p className="text-sm text-emerald-900">{ns.text}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Next Shot Actions */}
                      {details.nextShotActions && details.nextShotActions.length > 0 && (
                        <div>
                          <h4 className="text-sm font-bold text-steel-900 mb-3">Recommendation Actions (Next Shot)</h4>
                          <div className="space-y-2">
                            {details.nextShotActions.map((action: any) => {
                              const date = action.inputDate ? new Date(action.inputDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
                              return (
                                <div key={action.id} className="rounded-lg border border-steel-200 bg-white p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-steel-900 text-sm">{action.inputBy}:</span>
                                    <span className="text-xs text-steel-500">{date}</span>
                                  </div>
                                  <p className="text-sm text-steel-700">{action.text}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Project Details */}
                      <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-semibold text-steel-400 pt-3 border-t border-steel-200">
                        <span className="rounded bg-steel-100 px-1.5 py-0.5">{item.projectName}</span>
                        <span>/</span>
                        <span className="rounded bg-steel-100 px-1.5 py-0.5">{item.normalizedFamily}</span>
                        <span>/</span>
                        <span className="rounded bg-steel-100 px-1.5 py-0.5">{item.material} / {item.gateType}</span>
                      </div>
                    </div>
                  )}
                </article>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-steel-500 border-2 border-dashed border-steel-200 rounded-xl">No rows match this drill-down.</div>
          )}
        </div>

        {drilldown.totalPages > 1 && !drilldown.loading && !drilldown.error ? (
          <footer className="flex items-center justify-between border-t border-steel-200 px-5 py-3">
            <p className="text-xs text-steel-500">
              Page {drilldown.page} of {drilldown.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPage(drilldown.page - 1)}
                disabled={drilldown.page <= 1}
                className="rounded-lg border border-steel-200 px-3 py-1.5 text-xs font-semibold text-steel-700 hover:bg-steel-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => onPage(drilldown.page + 1)}
                disabled={drilldown.page >= drilldown.totalPages}
                className="rounded-lg border border-steel-200 px-3 py-1.5 text-xs font-semibold text-steel-700 hover:bg-steel-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function DrillList({
  items,
  onOpen,
  className = "",
}: {
  items: Array<{ name: string; count: number; color?: string }>;
  onOpen: (name: string) => void;
  className?: string;
}) {
  return (
    <div className={`mt-4 flex flex-col max-h-[140px] overflow-y-auto compact-scrollbar ${className}`}>
      {items.map((item) => (
        <button
          key={item.name}
          type="button"
          onClick={() => onOpen(item.name)}
          className="group flex items-center justify-between py-2 border-b border-steel-100 last:border-0 text-left text-xs transition-all hover:bg-steel-50 px-2"
        >
          <span className="flex min-w-0 items-center gap-2">
            {item.color ? (
               <span className="h-2 w-2 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
            ) : (
               <span className="h-2 w-2 shrink-0 rounded-full bg-steel-300 group-hover:bg-accent-400 transition-colors" />
            )}
            <span className="truncate font-medium text-steel-700 group-hover:text-accent-700 transition-colors">{item.name}</span>
          </span>
          <span className="ml-3 font-mono font-bold text-steel-600">
            {item.count}
          </span>
        </button>
      ))}
    </div>
  );
}

export function OverviewDashboard({ stats }: OverviewDashboardProps) {
  const [drilldown, setDrilldown] = useState<DrilldownState>(null);

  // All counts arrive pre-aggregated from SQL. The cumulative percentage is
  // still derived here because it depends on how many bars we choose to show.
  const totalFailures = stats.failureFrequency.reduce((sum, item) => sum + item.count, 0);
  let cumulativeCount = 0;
  const failureFrequency = stats.failureFrequency.slice(0, 8).map((item) => {
    cumulativeCount += item.count;
    return {
      ...item,
      cumulativePercentage: totalFailures ? Math.round((cumulativeCount / totalFailures) * 100) : 0,
    };
  });

  const riskDistribution = stats.riskDistribution;

  const statusMap: Record<string, string> = { "Close FS": "Close First Shot", "Close NS": "Close Next Shot" };
  const totalStatusCount = stats.statusMix.reduce((sum, item) => sum + item.count, 0);
  const statusData = stats.statusMix.map((item) => ({
    name: statusMap[item.name] || item.name,
    rawName: item.name,
    value: item.count,
    percentage: totalStatusCount ? Math.round((item.count / totalStatusCount) * 100) : 0,
  }));

  const familyData = stats.partGroups.map((item) => ({
    name: item.name,
    count: item.count,
    repeatedFailures: item.failureTypes,
  }));

  const materialGateRows = stats.materialGate;
  const maxMaterialGate = Math.max(1, ...materialGateRows.map((item) => item.count));

  /** Opens the drawer, then fetches just that segment's rows. */
  function openDrilldown(title: string, dimension: Dimension, value: string, page = 1) {
    setDrilldown({
      title,
      dimension,
      value,
      rows: [],
      total: 0,
      page,
      totalPages: 0,
      loading: true,
      error: null,
      expandedCaseId: null,
      caseDetails: {},
    });
    void fetchDrilldownPage(dimension, value, page);
  }

  async function fetchDrilldownPage(dimension: Dimension, value: string, page: number) {
    try {
      const params = new URLSearchParams({ dimension, value, page: String(page), limit: "50" });
      const data = await fetchJson<{
        rows: DashboardCase[];
        pagination: { total: number; page: number; totalPages: number };
      }>(`/api/dashboard/cases?${params}`);

      setDrilldown((prev) =>
        prev
          ? {
              ...prev,
              rows: data.rows,
              total: data.pagination.total,
              page: data.pagination.page,
              totalPages: data.pagination.totalPages,
              loading: false,
              error: null,
              expandedCaseId: null,
            }
          : prev,
      );
    } catch (err) {
      setDrilldown((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : "Failed to load rows.",
            }
          : prev,
      );
    }
  }

  function goToPage(page: number) {
    setDrilldown((prev) => (prev ? { ...prev, loading: true, error: null, page } : prev));
    const current = drilldown;
    if (current) void fetchDrilldownPage(current.dimension, current.value, page);
  }

  function openFailureRows(failure: string) {
    if (!failure) return;
    openDrilldown(`Failure frequency: ${failure}`, "failure", failure);
  }

  function openRiskRows(bucket: string) {
    if (!bucket) return;
    openDrilldown(`RPN bucket: ${bucket}`, "risk", bucket);
  }

  function openStatusRows(status: string) {
    if (!status) return;
    openDrilldown(`Status: ${status}`, "status", status);
  }

  function openFamilyRows(family: string, titlePrefix = "Part group") {
    if (!family) return;
    openDrilldown(`${titlePrefix}: ${family}`, "family", family);
  }

  return (
    <div className="space-y-6 animate-slide-up">


      {/* Charts */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <div className="rounded-2xl border border-steel-200 bg-white dark:bg-steel-900 dark:border-steel-700 p-6 shadow-panel flex flex-col">
          <h2 className="text-base font-bold text-steel-900">Failure Frequency</h2>
          <p className="text-[11px] font-medium text-steel-500 mt-0.5">Cumulative % reflects proportion of top 15 failures</p>
          <div className="mt-4 flex-1 min-h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={failureFrequency} margin={{ top: 20, right: -10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569', fontWeight: 500 }} axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }} interval={0} angle={-35} textAnchor="end" height={60} />
                <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(val) => `${val}%`} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                <Bar
                  dataKey="count"
                  yAxisId="left"
                  fill="#1a73e8"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(data: ChartClickPayload) => {
                    openFailureRows(getChartName(data));
                  }}
                  activeBar={{ fill: '#a152f9' }}
                >
                  <LabelList dataKey="count" position="top" fill="#475569" fontSize={11} fontWeight={600} />
                </Bar>
                <Line yAxisId="right" name="Cumulative %" dataKey="cumulativePercentage" type="monotone" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <DrillList
            items={failureFrequency}
            onOpen={openFailureRows}
          />
        </div>
        <div className="rounded-2xl border border-steel-200 bg-white dark:bg-steel-900 dark:border-steel-700 p-6 shadow-panel flex flex-col">
          <h2 className="text-base font-bold text-steel-900">Part Group vs Repeated Failures</h2>
            <div className="mt-6 flex-1 min-h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={familyData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }} axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }} />
                  <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                  <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 500, color: '#475569' }} />
                  <Bar
                    dataKey="count"
                    fill="#1a73e8"
                    radius={[4, 4, 0, 0]}
                    name="Rows"
                    cursor="pointer"
                    onClick={(data: ChartClickPayload) => {
                      openFamilyRows(getChartName(data));
                    }}
                    activeBar={{ fill: '#a152f9' }}
                  >
                    <LabelList dataKey="count" position="top" fill="#475569" fontSize={11} fontWeight={600} />
                  </Bar>
                  <Bar
                    dataKey="repeatedFailures"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    name="Failure types"
                    cursor="pointer"
                    onClick={(data: ChartClickPayload) => {
                      openFamilyRows(getChartName(data), "Failure types in part group");
                    }}
                    activeBar={{ fill: '#059669' }}
                  >
                    <LabelList dataKey="repeatedFailures" position="top" fill="#059669" fontSize={11} fontWeight={600} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <DrillList
              items={familyData.map((item) => ({ name: item.name, count: item.count }))}
              onOpen={openFamilyRows}
            />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-steel-200 bg-white dark:bg-steel-900 dark:border-steel-700 p-6 shadow-panel flex flex-col">
            <h2 className="text-base font-bold text-steel-900">Risk Distribution</h2>
          <div className="mt-6 flex-1 h-[160px] min-h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskDistribution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }} axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }} />
                <YAxis allowDecimals={false} domain={[0, 'dataMax + 400']} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={{ stroke: '#cbd5e1' }} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                <Bar
                  dataKey="count"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(data: ChartClickPayload) => {
                    openRiskRows(getChartName(data));
                  }}
                >
                  {riskDistribution.map((entry) => (
                    <Cell key={entry.name} fill={bucketColors[entry.name]} />
                  ))}
                  <LabelList dataKey="count" position="top" fill="#475569" fontSize={11} fontWeight={600} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <DrillList
            items={riskDistribution.map((item) => ({ ...item, color: bucketColors[item.name] }))}
            onOpen={openRiskRows}
          />
        </div>

          <div className="rounded-2xl border border-steel-200 bg-white dark:bg-steel-900 dark:border-steel-700 p-6 shadow-panel flex flex-col">
            <h2 className="text-base font-bold text-steel-900">Status Mix</h2>
            <div className="mt-6 flex-1 flex flex-col gap-6">
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                      cursor="pointer"
                      stroke="none"
                      onClick={(data: { payload?: { rawName?: string } }) => {
                        // rawName, not the display label: "Close First Shot" is
                        // shown to the user but stored as "Close FS".
                        openStatusRows(data.payload?.rawName ?? "");
                      }}
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={entry.name} fill={statusColors[index % statusColors.length]} className="hover:opacity-80 transition-opacity" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col justify-center space-y-2.5">
                {statusData.map((item, index) => (
                  <button
                    type="button"
                    key={item.name}
                    onClick={() => openStatusRows(item.rawName)}
                    className="group flex w-full items-center justify-between rounded-xl border border-transparent bg-steel-50 px-4 py-2.5 text-left text-sm transition-all hover:border-steel-200 hover:bg-white dark:bg-steel-900 dark:border-steel-700 hover:shadow-sm"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="h-3 w-3 rounded-full shadow-sm"
                        style={{ backgroundColor: statusColors[index % statusColors.length] }}
                      />
                      <span className="font-medium text-steel-700">{item.name}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-steel-400">{item.percentage}%</span>
                      <strong className="text-steel-900">{item.value}</strong>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-steel-200 bg-white dark:bg-steel-900 dark:border-steel-700 p-6 shadow-panel flex flex-col">
            <h2 className="text-base font-bold text-steel-900">Material / Gate Heatmap</h2>
            <div className="mt-5 flex flex-col max-h-[140px] overflow-y-auto compact-scrollbar pr-1">
              {materialGateRows.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() =>
                    openDrilldown(`Material / gate: ${item.key}`, "materialGate", item.key)
                  }
                  className="group flex flex-col justify-center py-2.5 border-b border-steel-100 last:border-0 text-left transition-all hover:bg-steel-50 px-2"
                >
                  <div className="flex justify-between items-center w-full mb-1.5">
                    <span className="text-[11px] font-bold text-steel-700">{item.key}</span>
                    <span className="text-[10px] font-bold text-steel-500">{item.count}</span>
                  </div>
                  <div className="w-full h-1 overflow-hidden rounded-full bg-steel-100">
                    <div
                      // Scaled against the largest bar rather than a fixed
                      // multiplier, so the bars stay meaningful at any volume.
                      className="h-full rounded-full bg-gradient-to-r from-steel-400 to-steel-500 group-hover:from-accent-400 group-hover:to-accent-500 transition-all"
                      style={{ width: `${Math.round((item.count / maxMaterialGate) * 100)}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

      </section>

      <DrilldownDrawer
        drilldown={drilldown}
        onClose={() => setDrilldown(null)}
        onUpdate={(update) => setDrilldown(prev => prev ? { ...prev, ...update } : null)}
        onPage={goToPage}
      />
    </div>
  );
}
