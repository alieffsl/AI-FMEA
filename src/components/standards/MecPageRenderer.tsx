import {
  BookOpen,
  Shield,
  Target,
  FileText,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from "lucide-react";
import type { MecV2Page, MecV2Section } from "../../data/mecProductStandardsV2";
import sourceMapping from "../../data/sourceMapping.json";
import { DocumentViewer } from "./DocumentViewer";
import { useState, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// Section type styles
// ═══════════════════════════════════════════════════════════════════════════

const sectionTypeConfig: Record<
  string,
  { label: string; color: string; icon: typeof Shield }
> = {
  design_rule: {
    label: "Design Rule",
    color: "bg-blue-100 text-blue-800",
    icon: Shield,
  },
  guideline: {
    label: "Guideline",
    color: "bg-emerald-100 text-emerald-800",
    icon: BookOpen,
  },
  goal: {
    label: "Goal",
    color: "bg-violet-100 text-violet-800",
    icon: Target,
  },
  reference: {
    label: "Reference",
    color: "bg-steel-100 text-steel-700",
    icon: FileText,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Markdown Renderer (Simple)
// ═══════════════════════════════════════════════════════════════════════════

function renderMarkdown(text: string) {
  // A very simple markdown formatter for bullets and bold text
  const blocks = text.split('\n\n');
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.trim().startsWith('- ') || block.trim().startsWith('* ') || /^\d+\.\s/.test(block.trim())) {
          return (
            <ul key={i} className="list-inside list-disc space-y-1 ml-1 text-sm text-steel-600 leading-relaxed">
              {block.split('\n').map((line, j) => {
                const cleanLine = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
                const bolded = cleanLine.split(/(\*\*.*?\*\*)/g).map((part, k) => {
                  if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={k} className="font-semibold text-steel-900">{part.slice(2, -2)}</strong>;
                  }
                  return part;
                });
                return <li key={j}>{bolded}</li>;
              })}
            </ul>
          );
        }

        const bolded = block.split(/(\*\*.*?\*\*)/g).map((part, k) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={k} className="font-semibold text-steel-900">{part.slice(2, -2)}</strong>;
          }
          return part;
        });
        
        return (
          <p key={i} className="text-sm text-steel-600 leading-relaxed">
            {bolded}
          </p>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Dispatcher
// ═══════════════════════════════════════════════════════════════════════════

interface MecPageRendererProps {
  page: MecV2Page;
  onNavigate: (slug: string) => void;
}

export function MecPageRenderer({ page, onNavigate }: MecPageRendererProps) {
  const [showSource, setShowSource] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  
  const sourcePath = (sourceMapping as Record<string, string>)[page.slug];

  return (
    <>
      <div className={`flex gap-6 h-full ${showSource ? "overflow-hidden" : ""}`}>
        <div className={`flex-1 transition-all ${showSource ? "overflow-y-auto compact-scrollbar pr-2" : ""}`}>
          <GuidelineArticle 
            page={page} 
            onNavigate={onNavigate} 
            sourcePath={sourcePath}
            showSource={showSource}
            onToggleSource={() => setShowSource(!showSource)}
            onImageClick={setZoomedImage}
          />
        </div>
        {showSource && sourcePath && (
          <div className="w-1/2 shrink-0 border-l border-steel-200 pl-6 h-full overflow-hidden">
            <DocumentViewer 
              fileUrl={`/MEC/${sourcePath}`} 
              onClose={() => setShowSource(false)} 
            />
          </div>
        )}
      </div>
      
      {/* Zoom Modal */}
      {zoomedImage && (
        <ImageModal 
          imageUrl={resolveImageUrl(zoomedImage)}
          imageName={imageLabel(zoomedImage)}
          onClose={() => setZoomedImage(null)} 
        />
      )}
    </>
  );
}

function resolveImageUrl(reference: string): string {
  if (reference.startsWith("/") || /^https?:\/\//i.test(reference)) return reference;
  return `/mec_images/${reference}`;
}

function imageLabel(reference: string): string {
  return decodeURIComponent(reference.split("/").pop() || reference);
}

function ImageModal({ imageUrl, imageName, onClose }: { imageUrl: string, imageName: string, onClose: () => void }) {
  const defaultZoom = 75;
  const [zoom, setZoom] = useState(defaultZoom);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-steel-900/80 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative flex h-[90vh] max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex shrink-0 items-center justify-between border-b border-steel-100 px-4 py-3 bg-white/50 backdrop-blur">
          <span className="font-semibold text-sm text-steel-800 truncate pr-4">
            {imageName}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom((value) => Math.max(50, value - 25))}
              disabled={zoom <= 50}
              aria-label="Zoom out"
              className="rounded-lg p-2 text-steel-500 transition hover:bg-steel-100 hover:text-steel-800 disabled:opacity-30"
            >
              <ZoomOut size={18} />
            </button>
            <span className="w-14 text-center text-xs font-semibold tabular-nums text-steel-600">{zoom}%</span>
            <button
              onClick={() => setZoom((value) => Math.min(400, value + 25))}
              disabled={zoom >= 400}
              aria-label="Zoom in"
              className="rounded-lg p-2 text-steel-500 transition hover:bg-steel-100 hover:text-steel-800 disabled:opacity-30"
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={() => setZoom(defaultZoom)}
              aria-label="Reset zoom"
              className="rounded-lg p-2 text-steel-500 transition hover:bg-steel-100 hover:text-steel-800"
            >
              <RotateCcw size={17} />
            </button>
            <button 
              onClick={onClose}
              aria-label="Close image viewer"
              className="ml-2 shrink-0 rounded-full p-2 text-steel-400 hover:bg-steel-100 hover:text-steel-700 transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto bg-steel-50 p-4 text-center compact-scrollbar">
          <img 
            src={imageUrl} 
            alt={imageName}
            className="inline-block h-auto max-w-none rounded object-contain align-top shadow-sm"
            style={{ width: `${zoom}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Page Header (shared)
// ═══════════════════════════════════════════════════════════════════════════

function PageHeader({ 
  page, 
  sourcePath,
  showSource,
  onToggleSource
}: { 
  page: MecV2Page;
  sourcePath?: string;
  showSource: boolean;
  onToggleSource: () => void;
}) {
  const pageTypeLabel: Record<string, string> = {
    guideline_article: "Design Standard",
    technical_reference: "Technical Reference",
    tooling_baseline: "Tooling Baseline",
  };

  const pageTypeColor: Record<string, string> = {
    guideline_article: "bg-blue-100 text-blue-800",
    technical_reference: "bg-amber-100 text-amber-900",
    tooling_baseline: "bg-emerald-100 text-emerald-800",
  };

  return (
    <div className="rounded-2xl border border-steel-200 bg-white p-6 shadow-panel">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-steel-900 tracking-tight">
            {page.title}
          </h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {sourcePath && (
            <button
              onClick={onToggleSource}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                showSource 
                  ? "bg-accent-100 text-accent-700" 
                  : "bg-steel-100 text-steel-700 hover:bg-steel-200"
              }`}
            >
              <FileText size={14} />
              {showSource ? "Hide Source File" : "View Source File"}
            </button>
          )}
          <span
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
              pageTypeColor[page.page_type] || "bg-steel-100 text-steel-700"
            }`}
          >
            {pageTypeLabel[page.page_type] || page.page_type.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <CountBadge icon={BookOpen} label="Sections" count={page.sections.length} />
        <CountBadge 
          icon={FileText} 
          label="Images" 
          count={page.sections.reduce((acc, s) => acc + s.image_references.length, 0)} 
        />
      </div>
    </div>
  );
}

function CountBadge({
  icon: Icon,
  label,
  count,
}: {
  icon: typeof BookOpen;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-steel-500">
      <Icon size={13} className="text-steel-400" />
      <span className="font-bold text-steel-700">{count}</span>
      <span>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Guideline Article
// ═══════════════════════════════════════════════════════════════════════════

function GuidelineArticle({
  page,
  sourcePath,
  showSource,
  onToggleSource,
  onImageClick,
}: {
  page: MecV2Page;
  onNavigate: (slug: string) => void;
  sourcePath?: string;
  showSource: boolean;
  onToggleSource: () => void;
  onImageClick: (imgName: string) => void;
}) {
  return (
    <div className="space-y-5">
      <PageHeader 
        page={page} 
        sourcePath={sourcePath} 
        showSource={showSource} 
        onToggleSource={onToggleSource} 
      />
      {page.sections.map((section, index) => (
        <SectionCard 
          key={index} 
          section={section} 
          index={index} 
          onImageClick={onImageClick}
        />
      ))}
    </div>
  );
}

function SectionCard({
  section,
  index,
  onImageClick,
}: {
  section: MecV2Section;
  index: number;
  onImageClick: (imgName: string) => void;
}) {
  const config = sectionTypeConfig[section.type] || sectionTypeConfig.reference;
  const TypeIcon = config.icon;

  return (
    <div className="group rounded-2xl border border-steel-200 bg-white p-6 shadow-panel transition-all duration-200 hover:border-accent-200 hover:shadow-md">
      <div className="flex items-start gap-4">
        {/* Section number */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 text-sm font-bold text-white shadow-sm">
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-bold text-steel-900 leading-tight">
              {section.title}
            </h3>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${config.color}`}
            >
              <TypeIcon size={11} />
              {config.label}
            </span>
          </div>

          {/* Body */}
          {section.content.trim() && (
            <div className="mt-3">
              {renderMarkdown(section.content)}
            </div>
          )}

          {section.table && (
            <div className="mt-4 overflow-x-auto rounded-xl border border-steel-200">
              <table className="min-w-full border-collapse text-left text-xs">
                <thead className="bg-steel-100 text-steel-700">
                  <tr>
                    {section.table.columns.map((column, columnIndex) => (
                      <th
                        key={`${column}-${columnIndex}`}
                        className={`whitespace-nowrap border-b border-steel-200 px-3 py-2.5 font-bold ${columnIndex === 0 && !column ? "w-12 text-center" : ""}`}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-steel-100">
                  {section.table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="align-top even:bg-steel-50/60">
                      {section.table!.columns.map((_, columnIndex) => (
                        <td
                          key={columnIndex}
                          className={`px-3 py-2.5 text-steel-600 ${columnIndex === 0 && !section.table!.columns[columnIndex] ? "w-12 min-w-12 text-center text-base" : "min-w-[100px]"}`}
                        >
                          {row[columnIndex] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Section images */}
          {section.image_references.length > 0 && (
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {section.image_references.map((imgName, i) => (
                <div key={i} className="group/img relative rounded-xl border border-steel-200 bg-steel-50 p-2 flex flex-col items-center overflow-hidden">
                  <img 
                    src={resolveImageUrl(imgName)}
                    alt={imageLabel(imgName)}
                    className="max-h-64 object-contain rounded-lg shadow-sm transition-transform duration-300 group-hover/img:scale-[1.02]"
                    loading="lazy"
                  />
                  
                  {/* Hover Overlay */}
                  <div 
                    className="absolute inset-0 bg-steel-900/5 backdrop-blur-[1px] opacity-0 transition-opacity duration-200 group-hover/img:opacity-100 flex items-center justify-center cursor-pointer"
                    onClick={() => onImageClick(section.image_original_references?.[i] ?? imgName)}
                  >
                    <div className="rounded-full bg-white/90 p-3 shadow-lg text-steel-700 transform scale-95 transition-transform duration-200 group-hover/img:scale-100">
                      <ZoomIn size={24} />
                    </div>
                  </div>

                  {(section.image_captions?.[i] || !imgName.startsWith("/")) && (
                    <span className={`mt-2 break-words text-center relative z-10 ${
                      section.image_captions?.[i]
                        ? "px-2 text-[11px] leading-relaxed text-steel-500"
                        : "text-[9px] font-mono text-steel-400"
                    }`}>
                      {section.image_captions?.[i] || imgName}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
