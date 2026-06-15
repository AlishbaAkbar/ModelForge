"use client";

import { useState } from "react";
import {
  Database,
  Upload,
  FileText,
  Trash2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { Dataset } from "@/types";

interface DatasetsPanelProps {
  datasets: Dataset[];
  onUpload: () => void;
  onDelete: (id: string) => void;
}

function StatusBadge({ status }: { status: Dataset["status"] }) {
  const map = {
    ready: "status-ready",
    processing: "status-processing",
    uploaded: "status-pending",
    error: "status-failed",
  } as const;

  const labels = {
    ready: "Ready",
    processing: "Processing",
    uploaded: "Uploaded",
    error: "Error",
  };

  return (
    <span className={map[status]}>
      {status === "processing" && (
        <RefreshCw size={9} className="animate-spin" />
      )}
      {status === "error" && <AlertCircle size={9} />}
      {labels[status]}
    </span>
  );
}

export default function DatasetsPanel({
  datasets,
  onUpload,
  onDelete,
}: DatasetsPanelProps) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    await new Promise((r) => setTimeout(r, 400));
    onDelete(id);
    setDeleting(null);
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-xl font-bold text-white"
              style={{ fontFamily: "var(--font-display, 'Syne', sans-serif)" }}
            >
              Dataset Upload
            </h1>
            <p className="text-sm text-[#555a6e] mt-0.5">
              {datasets.length} dataset{datasets.length !== 1 ? "s" : ""} ·{" "}
              {datasets.filter((d) => d.status === "ready").length} ready for
              training
            </p>
          </div>
          <button onClick={onUpload} className="forge-btn-primary">
            <Upload size={14} />
            Upload Dataset
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {datasets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center mb-4">
              <Database size={24} className="text-[#3d4155]" />
            </div>
            <h3 className="text-base font-semibold text-[#8b90a0] mb-2">
              No datasets yet
            </h3>
            <p className="text-sm text-[#3d4155] max-w-xs">
              Upload a CSV or JSONL file to start fine-tuning Gemma on your
              custom data.
            </p>
            <button onClick={onUpload} className="forge-btn-primary mt-5">
              <Upload size={14} />
              Upload your first dataset
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className={cn(
                  "forge-card p-4 flex items-center gap-4 hover:border-white/[0.12] transition-all duration-200",
                  deleting === dataset.id && "opacity-50 scale-[0.99]"
                )}
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center shrink-0">
                  <FileText
                    size={18}
                    className={
                      dataset.format === "jsonl"
                        ? "text-sky-400"
                        : "text-emerald-400"
                    }
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#e2e5ee] truncate">
                      {dataset.name}
                    </span>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        dataset.format === "jsonl"
                          ? "bg-sky-500/10 text-sky-400"
                          : "bg-emerald-500/10 text-emerald-400"
                      )}
                    >
                      {dataset.format}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#555a6e]">
                    <span>{dataset.rows.toLocaleString()} rows</span>
                    <span>·</span>
                    <span>{dataset.size}</span>
                    <span>·</span>
                    <span>Uploaded {formatDate(dataset.uploadedAt)}</span>
                  </div>
                </div>

                {/* Status & Actions */}
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={dataset.status} />
                  <button
                    onClick={() => handleDelete(dataset.id)}
                    disabled={deleting === dataset.id}
                    className="forge-btn-ghost p-2 text-[#3d4155] hover:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
