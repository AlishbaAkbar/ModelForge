"use client";

import { useState } from "react";
import { X, Cpu, Play, Loader, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { startTrainingJob } from "@/lib/api";
import type { Dataset, TrainingJob } from "@/types";

interface TrainingModalProps {
  datasets: Dataset[];
  onClose: () => void;
  onJobStarted: (job: TrainingJob) => void;
}

export default function TrainingModal({
  datasets,
  onClose,
  onJobStarted,
}: TrainingModalProps) {
  const [formState, setFormState] = useState({
    jobName: `ModelForge-Gemma-${Date.now().toString().slice(-4)}`,
    baseModel: "Gemma 2B",
    datasetId: datasets[0]?.id || "",
    trainingSteps: 500,
    learningRate: 0.0002,
  });
  const [status, setStatus] = useState<"idle" | "submitting" | "success">(
    "idle"
  );

  const handleSubmit = async () => {
    if (!formState.datasetId) return;
    setStatus("submitting");

    // TODO: Connect to FastAPI → POST /api/training/start
    const result = await startTrainingJob(formState);

    if (result.status === "success") {
      setStatus("success");
      setTimeout(() => {
        onJobStarted(result.data);
        onClose();
      }, 1200);
    } else {
      setStatus("idle");
    }
  };

  const readyDatasets = datasets.filter((d) => d.status === "ready");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg forge-card animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <Cpu size={15} className="text-sky-400" />
            </div>
            <div>
              <h2
                className="text-base font-bold text-white"
                style={{ fontFamily: "var(--font-display, 'Syne', sans-serif)" }}
              >
                Configure Training Job
              </h2>
              <p className="text-xs text-[#555a6e]">Fine-tune with LoRA adapters</p>
            </div>
          </div>
          <button onClick={onClose} className="forge-btn-ghost p-2 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Job Name */}
          <div>
            <label className="forge-label block">Job Name</label>
            <input
              className="forge-input"
              value={formState.jobName}
              onChange={(e) =>
                setFormState({ ...formState, jobName: e.target.value })
              }
              placeholder="e.g. ModelForge-Gemma-Support-v1"
            />
          </div>

          {/* Base Model */}
          <div>
            <label className="forge-label block">Base Model</label>
            <div className="flex gap-2">
              {["Gemma 2B"].map((m) => (
                <button
                  key={m}
                  onClick={() => setFormState({ ...formState, baseModel: m })}
                  className={cn(
                    "flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all duration-150",
                    formState.baseModel === m
                      ? "bg-sky-500/10 border-sky-500/30 text-sky-400"
                      : "bg-white/[0.03] border-white/[0.07] text-[#8b90a0] hover:border-white/[0.14]"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Dataset */}
          <div>
            <label className="forge-label block">Select Dataset</label>
            {readyDatasets.length === 0 ? (
              <div className="px-3 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                No ready datasets found. Upload and process a dataset first.
              </div>
            ) : (
              <select
                className="forge-input"
                value={formState.datasetId}
                onChange={(e) =>
                  setFormState({ ...formState, datasetId: e.target.value })
                }
              >
                {readyDatasets.map((d) => (
                  <option key={d.id} value={d.id} style={{ background: "#161920" }}>
                    {d.name} ({d.rows.toLocaleString()} rows)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Training params */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="forge-label block">Training Steps</label>
              <input
                type="number"
                className="forge-input"
                value={formState.trainingSteps}
                min={100}
                max={5000}
                step={100}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    trainingSteps: Number(e.target.value),
                  })
                }
              />
              <p className="text-[10px] text-[#3d4155] mt-1">
                Recommended: 500–1000
              </p>
            </div>
            <div>
              <label className="forge-label block">Learning Rate</label>
              <input
                type="number"
                className="forge-input"
                value={formState.learningRate}
                min={0.00001}
                max={0.01}
                step={0.00001}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    learningRate: Number(e.target.value),
                  })
                }
              />
              <p className="text-[10px] text-[#3d4155] mt-1">
                Default: 2e-4 (LoRA)
              </p>
            </div>
          </div>

          {/* Info box */}
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs text-[#555a6e] space-y-1">
            <div className="flex justify-between">
              <span>Method</span>
              <span className="text-[#8b90a0]">LoRA (Low-Rank Adaptation)</span>
            </div>
            <div className="flex justify-between">
              <span>Rank</span>
              <span className="text-[#8b90a0]">16</span>
            </div>
            <div className="flex justify-between">
              <span>Alpha</span>
              <span className="text-[#8b90a0]">32</span>
            </div>
            <div className="flex justify-between">
              <span>Est. time</span>
              <span className="text-[#8b90a0]">
                ~{Math.round(formState.trainingSteps / 10)} min (GPU)
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.07] flex items-center justify-end gap-3">
          <button onClick={onClose} className="forge-btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              !formState.datasetId ||
              status !== "idle" ||
              readyDatasets.length === 0
            }
            className="forge-btn-primary"
          >
            {status === "submitting" ? (
              <>
                <Loader size={14} className="animate-spin" />
                Starting…
              </>
            ) : status === "success" ? (
              <>
                <CheckCircle size={14} />
                Job Started!
              </>
            ) : (
              <>
                <Play size={14} />
                Start Training
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
