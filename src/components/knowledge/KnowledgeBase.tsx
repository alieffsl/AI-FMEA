import { useEffect, useState } from "react";
import { Search, X, ChevronDown, ChevronUp, ZoomIn, XCircle } from "lucide-react";

type Base64Image = {
  filename: string;
  data: string;
  mimeType: string;
  size: number;
};

type KnowledgeRecord = {
  id: string;
  toy_num: string;
  toy_name: string;
  tool_num: string;
  tool_description: string;
  tool_category?: string;
  material_gate: string;
  failure_mode: string;
  learning: string;
  final_recommendation: string;
  status: string;
  evidence_images: string[];
  evidence_images_base64?: Base64Image[];
  created_at: string;
  updated_at: string;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type Filters = {
  toyName: string;
  toolDescription: string;
  toolCategory: string;
  failureMode: string;
  status: string;
};

const emptyFilters: Filters = {
  toyName: "",
  toolDescription: "",
  toolCategory: "",
  failureMode: "",
  status: "",
};

const searchExamples = [
  "JRT65",
  "ABS",
  "SUB GATE",
  "First Shot Failure",
  "white mark",
];

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium text-steel-600 dark:text-steel-300">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-steel-300 bg-white px-3 text-sm outline-none focus:border-steel-600 focus:ring-2 focus:ring-steel-200 dark:border-steel-700 dark:bg-steel-950 dark:text-white dark:focus:border-accent-500 dark:focus:ring-accent-500/20"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImageThumbnail({ src, alt, onClick, isBase64 = false }: { src: string; alt: string; onClick: () => void; isBase64?: boolean }) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  // For base64, src is already in the correct format
  // For URL, prepend protocol if not present
  // Protocol-relative rather than forcing http://, so evidence images are not
  // blocked as mixed content once the site is served over TLS.
  const fullUrl = isBase64
    ? src
    : (/^(https?:)?\/\//.test(src) ? src : `//${src}`);

  if (error) {
    return (
      <div className="h-20 w-20 rounded-md border border-steel-300 bg-steel-100 flex items-center justify-center text-xs text-steel-500 dark:border-steel-700 dark:bg-steel-800 dark:text-steel-400">
        No Image
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className="group relative block cursor-pointer"
      type="button"
    >
      <img
        src={fullUrl}
        alt={alt}
        className={`h-20 w-20 rounded-md border border-steel-200 object-cover shadow-sm transition hover:shadow-md dark:border-steel-700 ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => setLoading(false)}
        onError={() => {
          setError(true);
          setLoading(false);
        }}
      />
      {loading && (
        <div className="absolute inset-0 h-20 w-20 rounded-md border border-steel-300 bg-steel-100 animate-pulse dark:border-steel-700 dark:bg-steel-800" />
      )}
      {!loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/0 transition group-hover:bg-black/30 dark:group-hover:bg-black/50">
          <ZoomIn className="opacity-0 transition group-hover:opacity-100" size={20} color="white" />
        </div>
      )}
    </button>
  );
}

function ExpandableLearning({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldTruncate = text.length > 200;
  
  return (
    <div>
      <p className="text-steel-600 whitespace-pre-wrap dark:text-steel-300">
        {shouldTruncate && !isExpanded ? `${text.substring(0, 200)}...` : text}
      </p>
      {shouldTruncate && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-fuchsia-600 hover:text-fuchsia-700 dark:text-accent-400 dark:hover:text-accent-300"
        >
          {isExpanded ? (
            <>
              <ChevronUp size={14} />
              Show Less
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              Read More
            </>
          )}
        </button>
      )}
    </div>
  );
}

function ImageZoomModal({ src, alt, onClose, isBase64 = false }: { src: string; alt: string; onClose: () => void; isBase64?: boolean }) {
  // For base64, src is already in the correct format
  // For URL, prepend protocol if not present
  // Protocol-relative rather than forcing http://, so evidence images are not
  // blocked as mixed content once the site is served over TLS.
  const fullUrl = isBase64
    ? src
    : (/^(https?:)?\/\//.test(src) ? src : `//${src}`);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition"
        type="button"
      >
        <XCircle size={32} />
      </button>
      <img
        src={fullUrl}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function KnowledgeBase() {
  // Read URL search params for persistence
  const getInitialPage = () => {
    const params = new URLSearchParams(window.location.search);
    return parseInt(params.get('page') || '1');
  };

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [records, setRecords] = useState<KnowledgeRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [currentPage, setCurrentPage] = useState(getInitialPage());
  const [filterOptions, setFilterOptions] = useState<{
    toyNames: string[];
    toolDescriptions: string[];
    toolCategories: string[];
    failureModes: string[];
    statuses: string[];
  }>({
    toyNames: [],
    toolDescriptions: [],
    toolCategories: [],
    failureModes: [],
    statuses: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string; isBase64?: boolean } | null>(null);

  // Update URL when page changes (preserve other params)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('page', currentPage.toString());
    const newUrl = `/knowledge?${params.toString()}`;
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, '', newUrl);
    }
  }, [currentPage]);

  // Fetch filter options on mount
  useEffect(() => {
    async function fetchFilters() {
      try {
        const response = await fetch('/api/knowledge/filters');
        if (!response.ok) throw new Error('Failed to fetch filters');
        const data = await response.json();
        setFilterOptions(data);
      } catch (err: any) {
        console.error('Error fetching filters:', err);
      }
    }
    fetchFilters();
  }, []);

  // Fetch records when query, filters, or page changes
  useEffect(() => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      async function fetchRecords() {
        setLoading(true);
        setError(null);
        
        try {
          const params = new URLSearchParams();
          if (query) params.append('query', query);
          if (filters.toyName) params.append('toy_name', filters.toyName);
          if (filters.toolDescription) params.append('tool_description', filters.toolDescription);
          if (filters.toolCategory) params.append('tool_category', filters.toolCategory);
          if (filters.failureMode) params.append('failure_mode', filters.failureMode);
          if (filters.status) params.append('status', filters.status);
          params.append('page', currentPage.toString());
          params.append('limit', '50');

          console.log('[Frontend] Fetching with query:', query, 'filters:', filters, 'page:', currentPage);
          const response = await fetch(`/api/knowledge/search?${params}`, {
            signal: abortController.signal
          });
          if (!response.ok) throw new Error('Failed to fetch records');
          
          const data = await response.json();
          console.log('[Frontend] Received', data.records.length, 'records');
          setRecords(data.records);
          setPagination(data.pagination);
        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.log('[Frontend] Request aborted');
            return;
          }
          console.error('Error fetching records:', err);
          setError(err.message);
          setRecords([]);
        } finally {
          setLoading(false);
        }
      }

      fetchRecords();
    }, 300); // 300ms debounce

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [query, filters, currentPage]);

  // Reset to page 1 when filters or query change (but only if not already on page 1)
  useEffect(() => {
    console.log('[Frontend] Query or filters changed, currentPage:', currentPage);
    if (currentPage !== 1) {
      console.log('[Frontend] Resetting to page 1');
      setCurrentPage(1);
    }
  }, [query, filters]);

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  // Modern pagination component
  function Pagination() {
    const { page, totalPages, total } = pagination;
    
    if (totalPages <= 1) return null;

    const getPageNumbers = () => {
      const pages: (number | string)[] = [];
      const showMax = 7; // Show max 7 page buttons
      
      if (totalPages <= showMax) {
        // Show all pages if total is small
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Always show first page
        pages.push(1);
        
        if (page > 3) {
          pages.push('...');
        }
        
        // Show pages around current page
        const start = Math.max(2, page - 1);
        const end = Math.min(totalPages - 1, page + 1);
        
        for (let i = start; i <= end; i++) {
          pages.push(i);
        }
        
        if (page < totalPages - 2) {
          pages.push('...');
        }
        
        // Always show last page
        pages.push(totalPages);
      }
      
      return pages;
    };

    return (
      <div className="flex items-center justify-between border-t border-steel-200 px-4 py-3 dark:border-steel-700">
        <div className="flex flex-1 items-center justify-between">
          <div>
            <p className="text-sm text-steel-700 dark:text-steel-300">
              Showing <span className="font-medium">{(page - 1) * 50 + 1}</span> to{' '}
              <span className="font-medium">{Math.min(page * 50, total)}</span> of{' '}
              <span className="font-medium">{total.toLocaleString()}</span> records
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={page === 1}
              className="rounded-md border border-steel-300 bg-white px-3 py-2 text-sm font-medium text-steel-700 hover:bg-steel-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-steel-700 dark:bg-steel-950 dark:text-steel-100 dark:hover:bg-steel-700"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(page - 1)}
              disabled={page === 1}
              className="rounded-md border border-steel-300 bg-white px-3 py-2 text-sm font-medium text-steel-700 hover:bg-steel-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-steel-700 dark:bg-steel-950 dark:text-steel-100 dark:hover:bg-steel-700"
            >
              Previous
            </button>
            
            <div className="hidden sm:flex items-center gap-1">
              {getPageNumbers().map((pageNum, idx) =>
                pageNum === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-steel-500 dark:text-steel-400">
                    ...
                  </span>
                ) : (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum as number)}
                    className={`min-w-[40px] rounded-md border px-3 py-2 text-sm font-medium transition ${
                      page === pageNum
                        ? 'border-fuchsia-600 bg-fuchsia-600 text-white dark:border-accent-500 dark:bg-accent-500'
                        : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50 dark:border-steel-700 dark:bg-steel-950 dark:text-steel-100 dark:hover:bg-steel-700'
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              )}
            </div>
            
            <button
              onClick={() => setCurrentPage(page + 1)}
              disabled={page === totalPages}
              className="rounded-md border border-steel-300 bg-white px-3 py-2 text-sm font-medium text-steel-700 hover:bg-steel-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-steel-700 dark:bg-steel-950 dark:text-steel-100 dark:hover:bg-steel-700"
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={page === totalPages}
              className="rounded-md border border-steel-300 bg-white px-3 py-2 text-sm font-medium text-steel-700 hover:bg-steel-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-steel-700 dark:bg-steel-950 dark:text-steel-100 dark:hover:bg-steel-700"
            >
              Last
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {zoomedImage && (
        <ImageZoomModal
          src={zoomedImage.src}
          alt={zoomedImage.alt}
          isBase64={zoomedImage.isBase64}
          onClose={() => setZoomedImage(null)}
        />
      )}
      
      <section className="rounded-md border border-steel-200 bg-white p-4 shadow-panel dark:border-steel-700 dark:bg-steel-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block font-medium text-steel-600 dark:text-steel-300">Search Previous FMEA History</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel-400 dark:text-steel-500" size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by toy #, tool #, material, gate, failure, category, or keywords..."
                className="h-11 w-full rounded-md border border-steel-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-steel-600 focus:ring-2 focus:ring-steel-200 dark:border-steel-700 dark:bg-steel-950 dark:text-white dark:placeholder-steel-500 dark:focus:border-accent-500 dark:focus:ring-accent-500/20"
              />
            </div>
          </label>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFilters(emptyFilters);
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-steel-300 px-3 text-sm font-semibold text-steel-700 hover:bg-steel-100 dark:border-steel-700 dark:bg-steel-950 dark:text-steel-100 dark:hover:bg-steel-700"
          >
            <X size={16} />
            Clear
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {searchExamples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuery(example)}
              className="rounded-full bg-steel-100 px-3 py-1.5 text-xs font-medium text-steel-700 hover:bg-steel-200 dark:bg-steel-700 dark:text-steel-100 dark:hover:bg-steel-600"
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SelectFilter
            label="Toy / Product"
            value={filters.toyName}
            options={filterOptions.toyNames}
            onChange={(value) => updateFilter("toyName", value)}
          />
          <SelectFilter
            label="Tool Category"
            value={filters.toolCategory}
            options={filterOptions.toolCategories}
            onChange={(value) => updateFilter("toolCategory", value)}
          />
          <SelectFilter
            label="Tool Description"
            value={filters.toolDescription}
            options={filterOptions.toolDescriptions}
            onChange={(value) => updateFilter("toolDescription", value)}
          />
          <SelectFilter
            label="Failure Mode"
            value={filters.failureMode}
            options={filterOptions.failureModes}
            onChange={(value) => updateFilter("failureMode", value)}
          />
          <SelectFilter
            label="Status"
            value={filters.status}
            options={filterOptions.statuses}
            onChange={(value) => updateFilter("status", value)}
          />
        </div>
      </section>

      <section className="rounded-md border border-steel-200 bg-white shadow-panel dark:border-steel-700 dark:bg-steel-900">
        <div className="flex items-center justify-between border-b border-steel-200 px-4 py-3 dark:border-steel-700">
          <h2 className="font-semibold text-steel-950 dark:text-white">Previous FMEA Records</h2>
          <span className="rounded-full bg-steel-100 px-3 py-1 text-xs font-semibold text-steel-700 dark:bg-steel-700 dark:text-steel-100">
            {loading ? 'Loading...' : `${pagination.total.toLocaleString()} total`}
          </span>
        </div>
        
        {error ? (
          <div className="p-16 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">Error: {error}</p>
            <p className="mt-2 text-xs text-steel-500 dark:text-steel-400">Please check the backend connection</p>
          </div>
        ) : loading ? (
          <div className="p-16 text-center text-sm text-steel-500 dark:text-steel-400">
            Loading knowledge base records...
          </div>
        ) : records.length === 0 ? (
          <div className="p-16 text-center text-sm text-steel-500 dark:text-steel-400">
            No records match your search criteria.
          </div>
        ) : (
          <div className="compact-scrollbar overflow-x-auto">
            <table className="w-full divide-y divide-steel-200 text-left text-sm dark:divide-steel-700">
              <thead className="bg-steel-100 text-xs uppercase tracking-wide text-steel-600 dark:bg-steel-950 dark:text-steel-400">
                <tr>
                  <th className="px-3 py-3 w-[140px]">Project</th>
                  <th className="px-3 py-3 w-[140px]">Tool</th>
                  <th className="px-3 py-3 w-[120px]">Material / Gate</th>
                  <th className="px-3 py-3 w-[140px]">Failure Mode</th>
                  <th className="px-3 py-3 w-[280px]">Engineering Learning</th>
                  <th className="px-3 py-3 w-[280px]">Final Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-100 dark:divide-steel-700">
                {records.map((record) => (
                  <tr key={record.id} className="align-top hover:bg-steel-50 dark:hover:bg-steel-700/20">
                    <td className="px-3 py-3 w-[140px]">
                      <div className="font-semibold text-steel-950 break-words dark:text-white">{record.toy_num}</div>
                      <div className="text-xs text-steel-500 break-words dark:text-steel-400">{record.toy_name}</div>
                    </td>
                    <td className="px-3 py-3 w-[140px]">
                      <div className="font-semibold break-words dark:text-white">{record.tool_num}</div>
                      <div className="text-xs text-steel-500 break-words dark:text-steel-400">{record.tool_description}</div>
                    </td>
                    <td className="px-3 py-3 w-[120px]">
                      <div className="text-xs break-words dark:text-steel-300">{record.material_gate}</div>
                    </td>
                    <td className="px-3 py-3 w-[140px]">
                      <div className="font-medium text-steel-950 break-words dark:text-white">{record.failure_mode}</div>
                    </td>
                    <td className="px-3 py-3 w-[280px]">
                      <ExpandableLearning text={record.learning} />
                    </td>
                    <td className="px-3 py-3 w-[280px]">
                      <div className="text-steel-600 break-words dark:text-steel-300">{record.final_recommendation}</div>
                      {/* Prioritize base64 images if available, fallback to URL-based images */}
                      {record.evidence_images_base64 && record.evidence_images_base64.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {record.evidence_images_base64.map((img, idx) => (
                            <ImageThumbnail
                              key={idx}
                              src={`data:${img.mimeType};base64,${img.data}`}
                              alt={img.filename}
                              isBase64={true}
                              onClick={() => setZoomedImage({ 
                                src: `data:${img.mimeType};base64,${img.data}`, 
                                alt: `${img.filename} - ${record.failure_mode}`,
                                isBase64: true
                              })}
                            />
                          ))}
                        </div>
                      ) : record.evidence_images && record.evidence_images.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {record.evidence_images.map((imgUrl, idx) => (
                            <ImageThumbnail
                              key={idx}
                              src={imgUrl}
                              alt={`Evidence ${idx + 1}`}
                              isBase64={false}
                              onClick={() => setZoomedImage({ 
                                src: imgUrl, 
                                alt: `Evidence ${idx + 1} - ${record.failure_mode}`,
                                isBase64: false
                              })}
                            />
                          ))}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination />
      </section>
    </div>
  );
}
