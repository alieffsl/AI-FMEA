import { Download, FileText, FileImage, FileBarChart } from "lucide-react";
import { SpreadsheetViewer, SPREADSHEET_EXTENSIONS } from "./SpreadsheetViewer";

interface DocumentViewerProps {
  fileUrl: string;
  onClose?: () => void;
}

export function DocumentViewer({ fileUrl, onClose }: DocumentViewerProps) {
  const extension = fileUrl.split('.').pop()?.toLowerCase();

  const isImage = ["jpg", "jpeg", "png", "gif", "svg"].includes(extension || "");
  const isPdf = ["pdf"].includes(extension || "");
  // Workbooks are parsed and drawn in-page; only Office formats we cannot read
  // (.pptx, .docx) still fall through to the download prompt.
  const isSpreadsheet = SPREADSHEET_EXTENSIONS.includes(extension || "");

  const fileName = fileUrl.split('/').pop() || "Document";

  return (
    <div className="flex h-full flex-col bg-steel-50 rounded-xl overflow-hidden border border-steel-200">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-steel-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          {isPdf ? (
            <FileText size={18} className="text-red-500 shrink-0" />
          ) : isImage ? (
            <FileImage size={18} className="text-emerald-500 shrink-0" />
          ) : (
            <FileBarChart size={18} className="text-orange-500 shrink-0" />
          )}
          <span className="font-semibold text-sm text-steel-800 truncate" title={fileName}>
            {fileName}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <a
            href={fileUrl}
            download
            className="flex items-center gap-1.5 rounded-lg bg-steel-100 px-3 py-1.5 text-xs font-semibold text-steel-700 hover:bg-steel-200 transition"
          >
            <Download size={14} />
            Download
          </a>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-2 rounded-lg p-1.5 text-steel-400 hover:bg-steel-100"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Viewer Content */}
      <div
        className={`flex-1 overflow-auto bg-steel-100 ${
          isSpreadsheet ? "" : "flex items-center justify-center p-4"
        }`}
      >
        {isSpreadsheet ? (
          <SpreadsheetViewer fileUrl={fileUrl} />
        ) : isPdf ? (
          <iframe
            src={fileUrl}
            className="w-full h-full rounded shadow-sm bg-white border-0"
            title="PDF Document Viewer"
          />
        ) : isImage ? (
          <img
            src={fileUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded shadow-sm bg-white"
          />
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm rounded-2xl bg-white shadow-sm border border-steel-200">
            <FileBarChart size={48} className="text-steel-300 mb-4" />
            <h3 className="text-lg font-bold text-steel-900 mb-2">Office Document</h3>
            <p className="text-sm text-steel-500 mb-6">
              Browsers cannot natively render this document type inline. Please download the file to view its contents.
            </p>
            <a
              href={fileUrl}
              download
              className="flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-accent-600 transition"
            >
              <Download size={16} />
              Download {extension?.toUpperCase()}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
