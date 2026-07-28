import { useMemo, useState, useCallback } from "react";
import { MecPageRenderer } from "./MecPageRenderer";
import { KnowledgeBase } from "../knowledge/KnowledgeBase";
import {
  Search,
  X,
  ChevronDown,
  ChevronRight,
  Layers,
  Home,
  ArrowLeft,
  BookOpen,
  FileText,
  Package,
  Wrench,
  Shield,
} from "lucide-react";
import { mecV2Db, getV2Page, searchV2Pages, type MecV2Page } from "../../data/mecProductStandardsV2";
import {
  baselineToolingPages,
  getBaselineToolingPage,
  searchBaselineToolingPages,
} from "../../data/baselineStandards";

// ═══════════════════════════════════════════════════════════════════════════
// Dynamic Page Tree Generation
// ═══════════════════════════════════════════════════════════════════════════

interface NavNode {
  slug: string;
  label: string;
  icon?: typeof BookOpen;
  children?: NavNode[];
}

const BASELINE_TOOLING_GROUP_SLUG = "_baseline-tooling";

function buildTree(): NavNode[] {
  const barbieSlugs: MecV2Page[] = [];
  const accessoriesSlugs: MecV2Page[] = [];
  const processSlugs: MecV2Page[] = [];
  const otherSlugs: MecV2Page[] = [];

  mecV2Db.forEach((page) => {
    const s = page.slug;
    if (s.startsWith("barbie-") || s.includes("ken-") || s.includes("chelsea-") || s.includes("collector-doll")) {
      barbieSlugs.push(page);
    } else if (
      s.includes("belt") || s.includes("bracelet") || s.includes("brush") ||
      s.includes("crown") || s.includes("earring") || s.includes("headband") ||
      s.includes("necklace") || s.includes("shoe") || s.includes("sunglass") ||
      s.includes("hair-clip") || s.includes("doll-stand")
    ) {
      accessoriesSlugs.push(page);
    } else if (
      s.includes("molding") || s.includes("mold") || s.includes("process") ||
      s.includes("stamp") || s.includes("joint") || s.includes("design-standard") ||
      s.includes("guidelines") || s.includes("handbook") || s.includes("sop") ||
      s.includes("selection") || s.includes("envelope")
    ) {
      processSlugs.push(page);
    } else {
      otherSlugs.push(page);
    }
  });

  const mapToNode = (pages: MecV2Page[]) => pages.map(p => ({ slug: p.slug, label: p.title }));

  return [
    {
      slug: "_barbie-core",
      label: "Barbie Core Standards",
      icon: Layers,
      children: mapToNode(barbieSlugs),
    },
    {
      slug: "_accessories",
      label: "Accessories & Soft Goods",
      icon: Package,
      children: mapToNode(accessoriesSlugs),
    },
    {
      slug: "_processes",
      label: "Process & Component Guidelines",
      icon: Wrench,
      children: mapToNode(processSlugs),
    },
    {
      slug: "_other",
      label: "Other Product Standards",
      icon: FileText,
      children: mapToNode(otherSlugs),
    },
    {
      slug: BASELINE_TOOLING_GROUP_SLUG,
      label: "Baseline Standards (Tooling)",
      icon: Shield,
      children: mapToNode(baselineToolingPages),
    },
  ];
}

const PAGE_TREE: NavNode[] = buildTree();

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export function MecProductStandards({
  initialSection = "product-standards",
}: {
  initialSection?: "product-standards" | "history";
}) {
  const [selectedSlug, setSelectedSlug] = useState<string>(() =>
    initialSection === "history" ? "__history" : "__overview",
  );
  const [productStandardsExpanded, setProductStandardsExpanded] = useState(initialSection !== "history");
  const [query, setQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(
      window.location.pathname === "/standards"
        ? [BASELINE_TOOLING_GROUP_SLUG]
        : ["_barbie-core"],
    )
  );
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);

  const selectedPage = useMemo(
    () => selectedSlug === "__overview" ? null : getV2Page(selectedSlug) ?? getBaselineToolingPage(selectedSlug),
    [selectedSlug]
  );

  // Search results
  const searchResults = useMemo(() => {
    if (!query.trim()) return null;
    return [...searchV2Pages(query), ...searchBaselineToolingPages(query)];
  }, [query]);

  // Navigate to a page
  const navigateTo = useCallback(
    (slug: string) => {
      if (slug.startsWith("_")) return; 
      const page = getV2Page(slug) ?? getBaselineToolingPage(slug);
      if (page) {
        setNavigationHistory((prev) => [...prev, selectedSlug]);
        setSelectedSlug(slug);
        setExpandedNodes((prev) => {
          const next = new Set(prev);
          next.add(slug);
          // Expand parent if it belongs to a group
          PAGE_TREE.forEach(group => {
            if (group.children?.some(c => c.slug === slug)) {
              next.add(group.slug);
            }
            group.children?.forEach((child) => {
              if (child.children?.some((nested) => nested.slug === slug)) {
                next.add(group.slug);
                next.add(child.slug);
              }
            });
          });
          return next;
        });
      }
    },
    [selectedSlug]
  );

  // Go back
  const goBack = useCallback(() => {
    setNavigationHistory((prev) => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const lastSlug = newHistory.pop()!;
      setSelectedSlug(lastSlug);
      setExpandedNodes((prevNodes) => {
         const next = new Set(prevNodes);
         next.add(lastSlug);
         return next;
      });
      return newHistory;
    });
  }, []);

  // Toggle node expansion
  const toggleNode = useCallback((slug: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-120px)] gap-6">
      {/* ═══ Left Sidebar ═══ */}
      <aside className="w-72 flex flex-col gap-3 shrink-0">
        {/* Standards search */}
        {selectedSlug !== "__history" && <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel-400"
            size={18}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search standards..."
            className="h-11 w-full rounded-xl border border-steel-300 bg-white pl-10 pr-10 text-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-steel-400 hover:bg-steel-100"
            >
              <X size={14} />
            </button>
          )}
        </div>}

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto compact-scrollbar rounded-xl border border-steel-200 bg-white">
          {searchResults ? (
            <SearchResultsList
              results={searchResults}
              onSelect={(slug) => {
                navigateTo(slug);
                setQuery("");
              }}
              selectedSlug={selectedSlug}
            />
          ) : (
            <div className="p-2">
              <div className={`flex items-center rounded-lg ${selectedSlug === "__overview" ? "bg-accent-50 text-accent-700" : "text-steel-700 hover:bg-steel-50"}`}>
                <button
                  type="button"
                  onClick={() => setProductStandardsExpanded((expanded) => !expanded)}
                  aria-label="Toggle Product Standards"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-steel-400 hover:bg-steel-100"
                >
                  {productStandardsExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNavigationHistory((prev) => [...prev, selectedSlug]);
                    setSelectedSlug("__overview");
                    setProductStandardsExpanded(true);
                  }}
                  className="flex flex-1 items-center gap-2 py-2 pr-3 text-left text-sm font-semibold"
                >
                  <Home size={15} className={selectedSlug === "__overview" ? "text-accent-500" : "text-steel-400"} />
                  Product Standards
                </button>
              </div>

              {productStandardsExpanded && (
                <div className="mt-1 border-l border-steel-100 pl-1">
                  {PAGE_TREE.map((node) => (
                    <TreeNode
                      key={node.slug}
                      node={node}
                      depth={1}
                      selectedSlug={selectedSlug}
                      expandedNodes={expandedNodes}
                      onSelect={navigateTo}
                      onToggle={toggleNode}
                    />
                  ))}
                </div>
              )}

              <div className="mx-2 my-2 h-px bg-steel-100" />

              <button
                type="button"
                onClick={() => {
                  setNavigationHistory((prev) => [...prev, selectedSlug]);
                  setSelectedSlug("__history");
                  setQuery("");
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${selectedSlug === "__history" ? "bg-accent-50 text-accent-700" : "text-steel-700 hover:bg-steel-50"}`}
              >
                <FileText size={15} className={selectedSlug === "__history" ? "text-accent-500" : "text-steel-400"} />
                Previous FMEA History
              </button>
            </div>
          )}
        </div>

        {/* Stats footer */}
        <div className="rounded-xl border border-steel-200 bg-white px-3 py-2.5 text-center">
          <div className="flex items-center justify-center gap-3 text-[11px] text-steel-500">
            <span>
              <span className="font-bold text-steel-700">
                {mecV2Db.length + baselineToolingPages.length}
              </span>{" "}
              standards pages
            </span>
          </div>
        </div>
      </aside>

      {/* ═══ Main Content ═══ */}
      <main className="flex-1 overflow-y-auto compact-scrollbar pb-8">
        {/* Back button */}
        {navigationHistory.length > 0 && selectedSlug !== "__overview" && (
          <button
            type="button"
            onClick={goBack}
            className="mb-4 flex items-center gap-1.5 rounded-lg border border-steel-200 bg-white px-3 py-2 text-xs font-semibold text-steel-600 shadow-sm transition hover:bg-steel-50 hover:text-steel-900"
          >
            <ArrowLeft size={14} />
            Back
          </button>
        )}

        {selectedSlug === "__history" ? (
          <KnowledgeBase />
        ) : selectedSlug === "__overview" ? (
          <OverviewDashboard onNavigate={navigateTo} />
        ) : selectedPage ? (
          // We will update MecPageRenderer.tsx to accept V2Page
          <MecPageRenderer page={selectedPage as any} onNavigate={navigateTo} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Layers size={48} className="mx-auto text-steel-300" />
              <h2 className="mt-4 text-xl font-bold text-steel-600">
                Select a standard
              </h2>
              <p className="mt-2 text-sm text-steel-400">
                Choose from the navigation to view design standards.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tree Node
// ═══════════════════════════════════════════════════════════════════════════

function TreeNode({
  node,
  depth,
  selectedSlug,
  expandedNodes,
  onSelect,
  onToggle,
}: {
  node: NavNode;
  depth: number;
  selectedSlug: string;
  expandedNodes: Set<string>;
  onSelect: (slug: string) => void;
  onToggle: (slug: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes.has(node.slug);
  const isActive = selectedSlug === node.slug;
  const isGroup = node.slug.startsWith("_");
  const Icon = node.icon || BookOpen;

  return (
    <div>
      <div
        className={`group flex w-full items-center gap-1 rounded-lg pr-3 py-1.5 text-left text-[13px] transition ${
          isActive
            ? "bg-accent-50 text-accent-700 font-semibold border-l-2 border-accent-500"
            : "text-steel-600 hover:bg-steel-50 hover:text-steel-900"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.slug);
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-steel-400 hover:bg-steel-200/50 hover:text-steel-700"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => {
            if (isGroup) {
              onToggle(node.slug);
            } else {
              onSelect(node.slug);
            }
          }}
          className="flex flex-1 items-center gap-2 py-0.5"
        >
          {depth === 0 && (
            <Icon
              size={14}
              className={
                isActive ? "text-accent-500 shrink-0" : "text-steel-400 shrink-0"
              }
            />
          )}
          <span className="truncate flex-1 text-left">{node.label}</span>
          {!hasChildren && !isActive && (
             <span className="shrink-0 rounded-full bg-steel-100 px-1.5 py-0.5 text-[9px] font-bold text-steel-400">
               {(getV2Page(node.slug) ?? getBaselineToolingPage(node.slug))?.sections.length || 0}
             </span>
          )}
        </button>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child) => (
            <TreeNode
              key={child.slug}
              node={child}
              depth={depth + 1}
              selectedSlug={selectedSlug}
              expandedNodes={expandedNodes}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Overview Dashboard
// ═══════════════════════════════════════════════════════════════════════════

function OverviewDashboard({
  onNavigate,
}: {
  onNavigate: (slug: string) => void;
}) {
  const allPages = [...mecV2Db, ...baselineToolingPages];
  const totalSections = allPages.reduce((total, page) => total + page.sections.length, 0);
  const totalImages = allPages.reduce(
    (total, page) => total + page.sections.reduce((sum, section) => sum + section.image_references.length, 0),
    0,
  );

  const leafPages = (node: NavNode): NavNode[] =>
    node.children?.flatMap((child) => child.children ? leafPages(child) : [child]) ?? [];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-steel-200 bg-white p-6 shadow-panel">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-steel-400">MEC Product Standard Library</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-steel-900">Product Standards</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-steel-500">
          Browse the product-standard articles and tooling baseline records currently loaded in this application.
          Use the navigation tree or search to open a standard.
        </p>

        <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl border border-steel-200 lg:grid-cols-4">
          {[
            ["Product articles", mecV2Db.length],
            ["Tooling baseline records", baselineToolingPages.length],
            ["Sections", totalSections],
            ["Image references", totalImages],
          ].map(([label, value], index) => (
            <div key={label} className={`p-4 ${index > 0 ? "border-l border-steel-200" : ""}`}>
              <div className="text-2xl font-bold text-steel-900">{value}</div>
              <div className="mt-1 text-xs text-steel-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-base font-bold text-steel-900">Library sections</h2>
          <p className="mt-1 text-xs text-steel-500">The same sections are available in the navigation tree on the left.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {PAGE_TREE.map((collection) => {
            const Icon = collection.icon ?? BookOpen;
            const pages = leafPages(collection);
            return (
              <article key={collection.slug} className="rounded-2xl border border-steel-200 bg-white p-5 shadow-panel">
                <div className="flex items-center gap-3 border-b border-steel-100 pb-4">
                  <div className="rounded-lg bg-steel-100 p-2 text-steel-600">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-steel-900">{collection.label}</h3>
                    <p className="mt-0.5 text-xs text-steel-500">{pages.length} standards</p>
                  </div>
                </div>

                <div className="mt-2 divide-y divide-steel-100">
                  {pages.slice(0, 4).map((page) => (
                    <button
                      key={page.slug}
                      type="button"
                      onClick={() => onNavigate(page.slug)}
                      className="group flex w-full items-center gap-2 py-2.5 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-steel-600 group-hover:text-accent-700">{page.label}</span>
                      <ChevronRight size={14} className="text-steel-300 group-hover:text-accent-500" />
                    </button>
                  ))}
                </div>

                {pages.length > 4 && (
                  <p className="mt-3 text-xs text-steel-400">View all {pages.length} standards from the navigation tree.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Search Results
// ═══════════════════════════════════════════════════════════════════════════

function SearchResultsList({
  results,
  onSelect,
  selectedSlug,
}: {
  results: MecV2Page[];
  onSelect: (slug: string) => void;
  selectedSlug: string;
}) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-steel-400">
        <Search size={24} className="mb-2" />
        <p className="text-sm font-medium">No results found</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-steel-100">
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-steel-400">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </div>
      {results.map((doc) => {
        const isActive = selectedSlug === doc.slug;

        return (
          <button
            key={doc.slug}
            type="button"
            onClick={() => onSelect(doc.slug)}
            className={`w-full px-4 py-3 text-left transition ${
              isActive
                ? "bg-accent-50 border-l-4 border-l-accent-500"
                : "hover:bg-steel-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <BookOpen
                size={14}
                className={isActive ? "text-accent-500" : "text-steel-400"}
              />
              <span className="font-semibold text-sm text-steel-900">
                {doc.title}
              </span>
            </div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-steel-400">
              {doc.sections.length} Sections
            </div>
          </button>
        );
      })}
    </div>
  );
}
