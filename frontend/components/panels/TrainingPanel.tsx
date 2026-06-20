"use client";

import { useEffect, useState } from "react";
import { Play, Clock, CheckCircle, XCircle, Cpu, TrendingDown } from "lucide-react";
import { fetchTrainingJobs } from "@/lib/api";
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
  const areaPoints = [`${pad},${H}`, ...points, `${pad + (W - pad * 2)},${H}`].join(" ");

  return (
    <div className="rounded-lg bg-black/30 border border-white/[0.06] overflow-hidden p-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16">
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

        <polygon points={areaPoints} fill="url(#lossGradient)" opacity={0.3} />

        <defs>
          <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
        </defs>

        <polyline
          points={polyline}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

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
  const [backendJobs, setBackendJobs] = useState<TrainingJob[]>(jobs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchJobs = async () => {
    try {
      setLoading(true);
      setError("");

      setBackendJobs(await fetchTrainingJobs());
    } catch {
      setError("Backend is not running or training jobs could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    setBackendJobs(jobs);
  }, [jobs]);

  useEffect(() => {
    if (!backendJobs.some((job) => job.status === "running" || job.status === "pending")) {
      return;
    }

    const timer = window.setInterval(fetchJobs, 1500);
    return () => window.clearInterval(timer);
  }, [backendJobs]);

  const runningJobs = backendJobs.filter((j) => j.status === "running");
  const otherJobs = backendJobs.filter((j) => j.status !== "running");

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Training Jobs</h1>
            <p className="text-sm text-[#555a6e] mt-0.5">
              {backendJobs.length} jobs · {runningJobs.length} running
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={fetchJobs} className="forge-btn-secondary">
              Refresh
            </button>

            <button onClick={onNewJob} className="forge-btn-primary">
              <Play size={14} />
              New Training Job
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading && <p className="text-sm text-sky-400">Loading training jobs...</p>}

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {backendJobs.length === 0 && !loading ? (
          <div className="text-center text-[#555a6e] mt-20">
            No training jobs yet. Upload dataset and start training.
          </div>
        ) : (
          <>
            {runningJobs.map((job) => (
              <div key={job.id} className="forge-card p-5 border-sky-500/20">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <StatusIcon status={job.status} />
                    <div>
                      <div className="text-sm font-bold text-white">{job.name}</div>
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
                      Step {job.currentStep} / {job.totalSteps}
                    </span>
                    <span className="text-sky-400 font-medium">{job.progress}%</span>
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
                  <span>Started: {job.startedAt ? formatDate(new Date(job.startedAt)) : "—"}</span>
                </div>
              </div>
            ))}

            {otherJobs.map((job) => (
              <div key={job.id} className={cn("forge-card p-4 flex items-start gap-4")}>
                <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 bg-emerald-500/10 border-emerald-500/20">
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
                    {job.baseModel} · {job.datasetName} · {job.totalSteps} steps
                  </div>

                  <div className="mt-3">
                    <LossChart data={job.lossHistory} />
                  </div>
                </div>

                <div className="text-xs text-[#3d4155] shrink-0">
                  {job.startedAt ? formatDate(new Date(job.startedAt)) : "—"}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
