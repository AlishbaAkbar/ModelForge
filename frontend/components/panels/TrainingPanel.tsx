"use client";

import { Play, Clock, CheckCircle, XCircle, Cpu, TrendingDown } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { TrainingJob } from "@/types";

interface TrainingPanelProps {
  jobs: TrainingJob[];
  onNewJob: () => void;
}

function StatusIcon({ status }: { status: TrainingJob["status"] }) {
  const map = {
    pending: <Clock size={14} className="text-amber-400" />,
    running: <Cpu size={14} className="text-sky-400 animate-pulse" />,
    completed: <CheckCircle size={14} className="text-emerald-400" />,
    failed: <XCircle size={14} className="text-red-400" />,
  };
  return map[status];
}

function StatusBadge({ status }: { status: TrainingJob["status"] }) {
  const map = {
    pending: "status-pending",
    running: "status-training",
    completed: "status-ready",
    failed: "status-failed",
  } as const;
  return <span className={map[status]}>{status}</span>;
}

// Mini sparkline SVG loss chart
function LossChart({ data }: { data: number[] }) {
  if (!data || data.length < 2) {
    return (
      <div className="h-16 rounded-lg bg-white/[0.02] border border-white/[0.06] flex items-center justify-center text-xs text-[#3d4155]">
        No training data yet
      </div>
    );
  }

  const W = 300;
  const H = 64;
  const pad = 8;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = pad + ((max - val) / range) * (H - pad * 2);
    return `${x},${y}`;
  });

  const polyline = points.join(" ");
  const areaPoints = [
    `${pad},${H}`,
    ...points,
    `${pad + (W - pad * 2)},${H}`,
  ].join(" ");

  return (
    <div className="rounded-lg bg-black/30 border border-white/[0.06] overflow-hidden p-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={pad}
            y1={pad + frac * (H - pad * 2)}
            x2={W - pad}
            y2={pad + frac * (H - pad * 2)}
            className="chart-grid-line"
          />
        ))}
        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill="url(#lossGradient)"
          opacity={0.3}
        />
        <defs>
          <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* End dot */}
        {points.length > 0 && (
          <circle
            cx={parseFloat(points[points.length - 1].split(",")[0])}
            cy={parseFloat(points[points.length - 1].split(",")[1])}
            r={3}
            fill="#0ea5e9"
          />
        )}
      </svg>
      <div className="flex justify-between px-2 pb-1 text-[10px] text-[#3d4155]">
        <span>Step 0</span>
        <div className="flex items-center gap-1 text-sky-400">
          <TrendingDown size={10} />
          <span>Loss: {data[data.length - 1]?.toFixed(3)}</span>
        </div>
        <span>Step {data.length * 50}</span>
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export default function TrainingPanel({ jobs, onNewJob }: TrainingPanelProps) {
  const runningJobs = jobs.filter((j) => j.status === "running");
  const otherJobs = jobs.filter((j) => j.status !== "running");

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
              Training Jobs
            </h1>
            <p className="text-sm text-[#555a6e] mt-0.5">
              {jobs.length} job{jobs.length !== 1 ? "s" : ""} ·{" "}
              {runningJobs.length} running
            </p>
          </div>
          <button onClick={onNewJob} className="forge-btn-primary">
            <Play size={14} />
            New Training Job
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center mb-4">
              <Cpu size={24} className="text-[#3d4155]" />
            </div>
            <h3 className="text-base font-semibold text-[#8b90a0] mb-2">
              No training jobs yet
            </h3>
            <p className="text-sm text-[#3d4155] max-w-xs mb-5">
              Start a fine-tuning job after uploading your dataset.
            </p>
            <button onClick={onNewJob} className="forge-btn-primary">
              <Play size={14} />
              Start your first job
            </button>
          </div>
        ) : (
          <>
            {/* Active jobs */}
            {runningJobs.map((job) => (
              <div key={job.id} className="forge-card p-5 border-sky-500/20">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <StatusIcon status={job.status} />
                    <div>
                      <div className="text-sm font-bold text-white">
                        {job.name}
                      </div>
                      <div className="text-xs text-[#555a6e]">
                        {job.baseModel} · {job.datasetName}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={job.status} />
                </div>

                <div className="mb-2">
                  <div className="flex justify-between text-xs text-[#555a6e] mb-1.5">
                    <span>
                      Step {job.currentStep.toLocaleString()} /{" "}
                      {job.totalSteps.toLocaleString()}
                    </span>
                    <span className="text-sky-400 font-medium">
                      {job.progress}%
                    </span>
                  </div>
                  <ProgressBar progress={job.progress} />
                </div>

                <div className="mt-3">
                  <div className="text-xs text-[#555a6e] mb-1.5 flex items-center gap-1.5">
                    <TrendingDown size={11} />
                    Training Loss
                  </div>
                  <LossChart data={job.lossHistory} />
                </div>

                <div className="mt-3 flex gap-4 text-xs text-[#555a6e]">
                  <span>LR: {job.learningRate}</span>
                  <span>·</span>
                  <span>
                    Started: {job.startedAt ? formatDate(job.startedAt) : "—"}
                  </span>
                </div>
              </div>
            ))}

            {/* Other jobs */}
            {otherJobs.map((job) => (
              <div
                key={job.id}
                className={cn(
                  "forge-card p-4 flex items-start gap-4 hover:border-white/[0.12] transition-all duration-200"
                )}
              >
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 mt-0.5",
                    job.status === "completed"
                      ? "bg-emerald-500/10 border-emerald-500/20"
                      : job.status === "pending"
                      ? "bg-amber-500/10 border-amber-500/20"
                      : "bg-red-500/10 border-red-500/20"
                  )}
                >
                  <StatusIcon status={job.status} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#e2e5ee] truncate">
                      {job.name}
                    </span>
                    <StatusBadge status={job.status} />
                  </div>
                  <div className="text-xs text-[#555a6e]">
                    {job.baseModel} · {job.datasetName} ·{" "}
                    {job.totalSteps.toLocaleString()} steps
                  </div>

                  {job.status === "completed" && job.lossHistory.length > 0 && (
                    <div className="mt-3">
                      <LossChart data={job.lossHistory} />
                    </div>
                  )}

                  {job.status === "pending" && (
                    <div className="mt-2">
                      <ProgressBar progress={0} />
                    </div>
                  )}
                </div>

                <div className="text-xs text-[#3d4155] shrink-0">
                  {job.completedAt
                    ? formatDate(job.completedAt)
                    : job.startedAt
                    ? formatDate(job.startedAt)
                    : "—"}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
