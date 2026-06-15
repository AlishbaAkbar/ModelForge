"use client";

import { useState, useRef, DragEvent } from "react";
import { X, Upload, FileText, CheckCircle, AlertCircle, Loader } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadDataset } from "@/lib/api";
import type { Dataset } from "@/types";

interface UploadModalProps {
  onClose: () => void;
  onSuccess: (dataset: Dataset) => void;
}

type UploadState = "idle" | "dragging" | "uploading" | "success" | "error";

export default function UploadModal({ onClose, onSuccess }: UploadModalProps) {
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "jsonl"].includes(ext || "")) {
      setErrorMsg("Unsupported format. Please upload CSV or JSONL files.");
      setUploadState("error");
      return;
    }
    setSelectedFile(file);
    setUploadState("idle");
    setErrorMsg("");
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setUploadState("idle");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setUploadState("dragging");
  };

  const handleDragLeave = () => setUploadState("idle");

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploadState("uploading");

    // TODO: Connect to FastAPI → POST /api/datasets/upload
    const result = await uploadDataset(selectedFile);

    if (result.status === "success") {
      setUploadState("success");
      setTimeout(() => {
        onSuccess(result.data);
        onClose();
      }, 1200);
    } else {
      setErrorMsg(result.message || "Upload failed.");
      setUploadState("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md forge-card animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div>
            <h2
              className="text-base font-bold text-white"
              style={{ fontFamily: "var(--font-display, 'Syne', sans-serif)" }}
            >
              Upload Dataset
            </h2>
            <p className="text-xs text-[#555a6e] mt-0.5">
              CSV or JSONL · Max 50 MB
            </p>
          </div>
          <button onClick={onClose} className="forge-btn-ghost p-2 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "relative flex flex-col items-center justify-center py-10 px-6 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200",
              uploadState === "dragging"
                ? "border-sky-500/60 bg-sky-500/[0.06]"
                : "border-white/[0.09] hover:border-white/[0.18] hover:bg-white/[0.02]",
              uploadState === "success" && "border-emerald-500/40 bg-emerald-500/[0.04]"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.jsonl"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {uploadState === "success" ? (
              <CheckCircle size={32} className="text-emerald-400 mb-3" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/[0.09] flex items-center justify-center mb-3">
                <Upload size={20} className="text-[#6b7080]" />
              </div>
            )}

            {selectedFile ? (
              <div className="text-center">
                <div className="flex items-center gap-2 justify-center mb-1">
                  <FileText size={14} className="text-sky-400" />
                  <span className="text-sm font-medium text-[#c8cdd8]">
                    {selectedFile.name}
                  </span>
                </div>
                <span className="text-xs text-[#555a6e]">
                  {(selectedFile.size / 1024).toFixed(1)} KB · Click to change
                </span>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-[#8b90a0] mb-1">
                  Drop your dataset here
                </p>
                <p className="text-xs text-[#3d4155]">
                  or <span className="text-sky-400">click to browse</span>
                </p>
              </div>
            )}
          </div>

          {/* Format hints */}
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                fmt: "JSONL",
                example: '{"prompt":"...","completion":"..."}',
                recommended: true,
              },
              { fmt: "CSV", example: "prompt,completion\n...", recommended: false },
            ].map((f) => (
              <div
                key={f.fmt}
                className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-bold text-[#8b90a0]">
                    {f.fmt}
                  </span>
                  {f.recommended && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-sky-500/15 text-sky-400 uppercase tracking-wider">
                      Recommended
                    </span>
                  )}
                </div>
                <code className="text-[10px] text-[#555a6e] font-mono">
                  {f.example}
                </code>
              </div>
            ))}
          </div>

          {/* Error message */}
          {uploadState === "error" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={14} className="text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.07] flex items-center justify-end gap-3">
          <button onClick={onClose} className="forge-btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploadState === "uploading" || uploadState === "success"}
            className="forge-btn-primary"
          >
            {uploadState === "uploading" ? (
              <>
                <Loader size={14} className="animate-spin" />
                Uploading…
              </>
            ) : uploadState === "success" ? (
              <>
                <CheckCircle size={14} />
                Uploaded!
              </>
            ) : (
              <>
                <Upload size={14} />
                Upload Dataset
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
