"use client";

import { useState } from "react";
import { Layers, Zap, Play, X, Send, Loader } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { testModel } from "@/lib/api";
import type { ModelCard } from "@/types";

interface ModelsPanelProps {
  models: ModelCard[];
}

function StatusBadge({ status }: { status: ModelCard["status"] }) {
  const map = {
    ready: "status-ready",
    training: "status-training",
    pending: "status-pending",
    failed: "status-failed",
  } as const;
  const labels = {
    ready: "Ready",
    training: "Training",
    pending: "Pending",
    failed: "Failed",
  };
  return <span className={map[status]}>{labels[status]}</span>;
}

function TestPanel({
  model,
  onClose,
}: {
  model: ModelCard;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setResponse("");

    // TODO: Connect to FastAPI → POST /api/models/{id}/test
    const result = await testModel(model.id, prompt);
    setResponse(result);
    setLoading(false);
  };

  return (
    <div className="mt-4 p-4 rounded-xl bg-black/20 border border-white/[0.07] animate-slide-up">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-[#8b90a0] uppercase tracking-wider">
          Test Model
        </span>
        <button onClick={onClose} className="text-[#3d4155] hover:text-[#8b90a0]">
          <X size={13} />
        </button>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          className="forge-input flex-1 text-xs"
          placeholder="Enter a test prompt…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleTest()}
        />
        <button
          onClick={handleTest}
          disabled={loading || !prompt.trim()}
          className="forge-btn-primary px-3"
        >
          {loading ? (
            <Loader size={13} className="animate-spin" />
          ) : (
            <Send size={13} />
          )}
        </button>
      </div>

      {response && (
        <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-[#c8cdd8] leading-relaxed whitespace-pre-wrap font-mono">
          {response}
        </div>
      )}
    </div>
  );
}

export default function ModelsPanel({ models }: ModelsPanelProps) {
  const [testingId, setTestingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <h1
          className="text-xl font-bold text-white"
          style={{ fontFamily: "var(--font-display, 'Syne', sans-serif)" }}
        >
          Models
        </h1>
        <p className="text-sm text-[#555a6e] mt-0.5">
          {models.filter((m) => m.status === "ready").length} ready ·{" "}
          {models.filter((m) => m.type === "finetuned").length} fine-tuned
          adapters
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Base models section */}
        <div>
          <div className="text-xs font-semibold text-[#3d4155] uppercase tracking-widest mb-3">
            Base Models
          </div>
          {models
            .filter((m) => m.type === "base")
            .map((model) => (
              <div key={model.id} className="forge-card p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center shrink-0">
                    <Layers size={18} className="text-[#6b7080]" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold text-white">
                        {model.name}
                      </h3>
                      <StatusBadge status={model.status} />
                    </div>
                    <p className="text-xs text-[#555a6e] mb-3 leading-relaxed">
                      {model.description}
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs text-[#3d4155]">
                      <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">
                        {model.parameters} params
                      </span>
                      <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">
                        Google DeepMind
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setTestingId(testingId === model.id ? null : model.id)
                    }
                    disabled={model.status !== "ready"}
                    className={cn(
                      "forge-btn-secondary text-xs shrink-0",
                      testingId === model.id &&
                        "bg-sky-500/10 border-sky-500/20 text-sky-400"
                    )}
                  >
                    <Play size={12} />
                    Test
                  </button>
                </div>
                {testingId === model.id && (
                  <TestPanel model={model} onClose={() => setTestingId(null)} />
                )}
              </div>
            ))}
        </div>

        {/* Fine-tuned models section */}
        <div>
          <div className="text-xs font-semibold text-[#3d4155] uppercase tracking-widest mb-3">
            Fine-tuned Adapters
          </div>
          {models
            .filter((m) => m.type === "finetuned")
            .map((model) => (
              <div
                key={model.id}
                className={cn(
                  "forge-card p-5 mb-3",
                  model.status === "ready" && "hover:border-sky-500/20 transition-all duration-200"
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl border flex items-center justify-center shrink-0",
                      model.status === "ready"
                        ? "bg-sky-500/10 border-sky-500/20"
                        : "bg-white/[0.03] border-white/[0.07]"
                    )}
                  >
                    <Zap
                      size={18}
                      className={
                        model.status === "ready"
                          ? "text-sky-400"
                          : "text-[#3d4155]"
                      }
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-sm font-bold text-white">
                        {model.name}
                      </h3>
                      <StatusBadge status={model.status} />
                      {model.accuracy && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {model.accuracy}% accuracy
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#555a6e] mb-3 leading-relaxed">
                      {model.description}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-[#3d4155]">
                      {model.baseModel && (
                        <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">
                          Base: {model.baseModel}
                        </span>
                      )}
                      {model.adapter && (
                        <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">
                          {model.adapter}
                        </span>
                      )}
                      <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">
                        {model.parameters}
                      </span>
                      <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">
                        Created {formatDate(model.createdAt)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      setTestingId(testingId === model.id ? null : model.id)
                    }
                    disabled={model.status !== "ready"}
                    className={cn(
                      "shrink-0 text-xs",
                      model.status === "ready"
                        ? testingId === model.id
                          ? "forge-btn-primary"
                          : "forge-btn-secondary"
                        : "forge-btn-ghost opacity-40 cursor-not-allowed"
                    )}
                  >
                    <Play size={12} />
                    {model.status === "ready" ? "Test" : "Unavailable"}
                  </button>
                </div>
                {testingId === model.id && model.status === "ready" && (
                  <TestPanel model={model} onClose={() => setTestingId(null)} />
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
