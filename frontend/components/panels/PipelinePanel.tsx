"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Brain,
  CheckCircle2,
  Clock,
  Database,
  FileSearch,
  Loader,
  MessageSquare,
  PackageCheck,
  RefreshCw,
  Rocket,
} from "lucide-react";
import {
  downloadKaggleOutput,
  exportColabPackage,
  exportKagglePackage,
  fetchPipelineStatus,
  fetchKaggleStatus,
  fetchTrainingArtifacts,
  generateTrainingDataset,
  runKaggleJob,
  startTrainingJob,
  uploadDataset as uploadDatasetFile,
} from "@/lib/api";

type StepState = "pending" | "running" | "completed" | "ready" | "blocked" | "base-only" | "failed";

interface PipelineStatus {
  status: "success" | "error";
  summary: {
    datasets: number;
    trainingJobs: number;
    models: number;
    ragIndexed: boolean;
  };
  latestDataset: null | {
    id: string;
    name: string;
    format: string;
    rows: number;
    size: string;
    uploadedAt: string;
  };
  latestTrainingJob: null | {
    id: string;
    name: string;
    baseModel: string;
    datasetId: string;
    datasetName: string;
    status: "pending" | "running" | "completed" | "failed";
    progress: number;
    currentStep: number;
    totalSteps: number;
    learningRate: number;
    lossHistory: number[];
  };
  latestModel: null | {
    id: string;
    name: string;
    baseModel: string;
    adapterPath: string;
    createdAt: string;
  };
  steps: Record<string, StepState>;
}

const emptyStatus: PipelineStatus = {
  status: "success",
  summary: {
    datasets: 0,
    trainingJobs: 0,
    models: 0,
    ragIndexed: false,
  },
  latestDataset: null,
  latestTrainingJob: null,
  latestModel: null,
  steps: {
    dataset: "pending",
    training: "pending",
    evaluation: "blocked",
    modelRegistry: "blocked",
    deployment: "blocked",
    inference: "base-only",
    rag: "pending",
  },
};

function stateClasses(state: StepState) {
  if (state === "completed" || state === "ready") {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  }

  if (state === "running") {
    return "bg-sky-500/10 text-sky-400 border-sky-500/20";
  }

  if (state === "failed" || state === "blocked") {
    return "bg-red-500/10 text-red-300 border-red-500/20";
  }

  if (state === "base-only") {
    return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  }

  return "bg-white/[0.04] text-[#8b91a3] border-white/[0.08]";
}

function StateIcon({ state }: { state: StepState }) {
  if (state === "completed" || state === "ready") {
    return <CheckCircle2 size={12} />;
  }

  if (state === "running") {
    return <Loader size={12} className="animate-spin" />;
  }

  if (state === "failed" || state === "blocked") {
    return <AlertCircle size={12} />;
  }

  return <Clock size={12} />;
}

function StepBadge({ state }: { state: StepState }) {
  const label = state === "base-only" ? "base only" : state;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${stateClasses(state)}`}>
      <StateIcon state={state} />
      {label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <div
        className="h-full rounded-full bg-sky-400 transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function PipelinePanel() {
  const [status, setStatus] = useState<PipelineStatus>(emptyStatus);
  const [artifacts, setArtifacts] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [colabPackage, setColabPackage] = useState<any>(null);
  const [kagglePackage, setKagglePackage] = useState<any>(null);
  const [trainingConfig, setTrainingConfig] = useState({
    hfModel: "sshleifer/tiny-gpt2",
    trainingSteps: 5,
    learningRate: 0.00005,
    maxExamples: 20,
    maxSeqLength: 128,
    batchSize: 1,
    gradAccum: 1,
    loraR: 8,
    loraAlpha: 16,
  });
  const [remoteConfig, setRemoteConfig] = useState({
    baseModel: "unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit",
    trainingSteps: 60,
    learningRate: 0.0002,
    maxExamples: 500,
    maxSeqLength: 1024,
    loraR: 16,
    loraAlpha: 16,
    driveRoot: "/content/drive/MyDrive/ModelForge/jobs",
  });
  const [kaggleConfig, setKaggleConfig] = useState({
    kaggleUsername: "",
    baseModel: "unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit",
    trainingSteps: 60,
    learningRate: 0.0002,
    maxExamples: 500,
    maxSeqLength: 1024,
    loraR: 16,
    loraAlpha: 16,
  });
  const [busyAction, setBusyAction] = useState<"refresh" | "upload" | "pdf" | "train" | "colab" | "kaggle" | "kaggle-run" | "kaggle-status" | "kaggle-download" | null>(null);

  const refreshStatus = async () => {
    try {
      setBusyAction((current) => current || "refresh");
      setError("");
      const data = await fetchPipelineStatus();
      setStatus(data);

      if (!datasetId && data.latestDataset?.id) {
        setDatasetId(data.latestDataset.id);
      }

      if (data.latestTrainingJob?.id) {
        try {
          setArtifacts(await fetchTrainingArtifacts(data.latestTrainingJob.id));
        } catch {
          setArtifacts(null);
        }
      }
    } catch {
      setError("Pipeline status could not be loaded. Make sure the FastAPI backend is running.");
    } finally {
      setBusyAction((current) => (current === "refresh" ? null : current));
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    const activeJob = status.latestTrainingJob;

    if (!activeJob || !["pending", "running"].includes(activeJob.status)) {
      return;
    }

    const timer = window.setInterval(refreshStatus, 1500);
    return () => window.clearInterval(timer);
  }, [status.latestTrainingJob?.id, status.latestTrainingJob?.status]);

  const uploadDataset = async () => {
    if (!datasetFile) {
      setMessage("Select a CSV or JSONL dataset first.");
      return;
    }

    setBusyAction("upload");
    setMessage("");
    setError("");

    const data = await uploadDatasetFile(datasetFile);

    if (data.status === "success") {
      setDatasetId(data.data.id);
      setMessage(`Dataset uploaded: ${data.data.name}`);
      await refreshStatus();
    } else {
      setError(data.message || "Dataset upload failed.");
    }

    setBusyAction(null);
  };

  const generateDatasetFromPDF = async () => {
    if (!pdfFile) {
      setMessage("Select a PDF first.");
      return;
    }

    setBusyAction("pdf");
    setMessage("Generating dataset from PDF...");
    setError("");

    const data = await generateTrainingDataset(pdfFile);

    if (data.status === "success") {
      setDatasetId(data.dataset_id);
      setMessage(`Generated ${data.rows} training rows from PDF.`);
      await refreshStatus();
    } else {
      setError(data.message || "Dataset generation failed.");
    }

    setBusyAction(null);
  };

  const startTraining = async () => {
    const selectedDatasetId = datasetId || status.latestDataset?.id;

    if (!selectedDatasetId) {
      setMessage("Upload or generate a dataset before starting fine-tuning.");
      return;
    }

    setBusyAction("train");
    setMessage("");
    setError("");

    const data = await startTrainingJob({
      jobName: "ModelForge Pipeline Fine-Tuning",
      baseModel: "qwen2.5:1.5b",
      datasetId: selectedDatasetId,
      trainingSteps: trainingConfig.trainingSteps,
      learningRate: trainingConfig.learningRate,
      hfModel: trainingConfig.hfModel,
      maxExamples: trainingConfig.maxExamples,
      maxSeqLength: trainingConfig.maxSeqLength,
      batchSize: trainingConfig.batchSize,
      gradAccum: trainingConfig.gradAccum,
      loraR: trainingConfig.loraR,
      loraAlpha: trainingConfig.loraAlpha,
    });

    if (data.status === "success") {
      setMessage(`Training started: ${data.data.id}`);
      await refreshStatus();
    } else {
      setError(data.message || "Training failed to start.");
    }

    setBusyAction(null);
  };

  const prepareColabPackage = async () => {
    const selectedDatasetId = datasetId || status.latestDataset?.id;

    if (!selectedDatasetId) {
      setMessage("Upload or generate a dataset before preparing a Colab package.");
      return;
    }

    setBusyAction("colab");
    setMessage("");
    setError("");

    try {
      const data = await exportColabPackage({
        datasetId: selectedDatasetId,
        ...remoteConfig,
      });
      setColabPackage(data);
      setMessage(`Colab QLoRA package created: ${data.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Colab package export failed.");
    }

    setBusyAction(null);
  };

  const prepareKagglePackage = async () => {
    const selectedDatasetId = datasetId || status.latestDataset?.id;

    if (!selectedDatasetId) {
      setMessage("Upload or generate a dataset before preparing a Kaggle package.");
      return;
    }

    if (!kaggleConfig.kaggleUsername.trim()) {
      setMessage("Enter your Kaggle username before preparing the runner.");
      return;
    }

    setBusyAction("kaggle");
    setMessage("");
    setError("");

    try {
      const data = await exportKagglePackage({
        datasetId: selectedDatasetId,
        ...kaggleConfig,
      });
      setKagglePackage(data);
      setMessage(`Kaggle GPU package created: ${data.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaggle package export failed.");
    }

    setBusyAction(null);
  };

  const submitKagglePackage = async () => {
    if (!kagglePackage?.jobId) {
      setMessage("Prepare a Kaggle package first.");
      return;
    }

    setBusyAction("kaggle-run");
    setMessage("");
    setError("");

    try {
      const data = await runKaggleJob(kagglePackage.jobId);
      setKagglePackage((prev: any) => ({ ...prev, ...data }));
      setMessage(data.message || "Kaggle job submitted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaggle job submission failed.");
    }

    setBusyAction(null);
  };

  const reloadKaggleStatus = async () => {
    if (!kagglePackage?.jobId) {
      setMessage("Prepare a Kaggle package first.");
      return;
    }

    setBusyAction("kaggle-status");
    setMessage("");
    setError("");

    try {
      const data = await fetchKaggleStatus(kagglePackage.jobId);
      setKagglePackage((prev: any) => ({ ...prev, ...data }));
      setMessage(data.message || "Kaggle status refreshed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaggle status refresh failed.");
    }

    setBusyAction(null);
  };

  const fetchKaggleOutput = async () => {
    if (!kagglePackage?.jobId) {
      setMessage("Prepare a Kaggle package first.");
      return;
    }

    setBusyAction("kaggle-download");
    setMessage("");
    setError("");

    try {
      const data = await downloadKaggleOutput(kagglePackage.jobId);
      setKagglePackage((prev: any) => ({ ...prev, ...data }));
      setMessage(data.message || "Kaggle outputs downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaggle output download failed.");
    }

    setBusyAction(null);
  };

  const steps = useMemo(
    () => [
      {
        key: "dataset",
        title: "Dataset",
        icon: Database,
        state: status.steps.dataset,
        detail: status.latestDataset
          ? `${status.latestDataset.name} | ${status.latestDataset.rows.toLocaleString()} rows | ${status.latestDataset.size}`
          : "Upload CSV/JSONL or generate JSONL from PDF.",
      },
      {
        key: "training",
        title: "Fine-Tuning",
        icon: Brain,
        state: status.steps.training,
        detail: status.latestTrainingJob
          ? `${status.latestTrainingJob.id} | ${status.latestTrainingJob.currentStep}/${status.latestTrainingJob.totalSteps} steps | loss ${status.latestTrainingJob.lossHistory.at(-1) ?? "N/A"}`
          : "Start a LoRA fine-tuning run from the selected dataset.",
      },
      {
        key: "evaluation",
        title: "Evaluation",
        icon: BarChart3,
        state: status.steps.evaluation,
        detail: status.latestTrainingJob?.status === "completed"
          ? "Latest completed run is ready for evaluation metrics."
          : "Blocked until a training job completes.",
      },
      {
        key: "modelRegistry",
        title: "Model Registry",
        icon: PackageCheck,
        state: status.steps.modelRegistry,
        detail: status.latestModel
          ? `${status.latestModel.name} | ${status.latestModel.adapterPath}`
          : "Completed training will register an adapter artifact.",
      },
      {
        key: "deployment",
        title: "Deployment",
        icon: Rocket,
        state: status.steps.deployment,
        detail: status.latestModel
          ? "Adapter artifact is ready for local runtime packaging."
          : "Blocked until an adapter exists.",
      },
      {
        key: "inference",
        title: "Inference",
        icon: MessageSquare,
        state: status.steps.inference,
        detail: status.latestModel
          ? "Chat can test the latest registered model path."
          : "Base model chat is available; fine-tuned inference waits for an adapter.",
      },
      {
        key: "rag",
        title: "RAG",
        icon: FileSearch,
        state: status.steps.rag,
        detail: status.summary.ragIndexed
          ? "FAISS index exists for document question answering."
          : "Upload a PDF in the RAG tab to build retrieval context.",
      },
    ],
    [status]
  );

  const latestJob = status.latestTrainingJob;
  const isWorking = busyAction !== null;

  return (
    <div className="relative flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-sky-400">
              ModelForge Pipeline
            </div>
            <h1 className="mb-3 text-3xl font-bold text-white">
              LLM Lifecycle Command Center
            </h1>
            <p className="max-w-3xl text-sm leading-relaxed text-[#8b91a3]">
              Run the core product flow from one place: prepare data, fine-tune,
              track artifacts, and move toward deployment and inference.
            </p>
          </div>

          <button
            onClick={refreshStatus}
            disabled={busyAction === "refresh"}
            className="forge-btn-secondary w-fit"
          >
            <RefreshCw size={14} className={busyAction === "refresh" ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Datasets", status.summary.datasets],
            ["Training Jobs", status.summary.trainingJobs],
            ["Adapters", status.summary.models],
            ["RAG Index", status.summary.ragIndexed ? "Ready" : "Missing"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="text-xs text-[#6b7080]">{label}</div>
              <div className="mt-1 text-xl font-semibold text-white">{value}</div>
            </div>
          ))}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Upload Dataset</h2>
            <input
              type="file"
              accept=".csv,.jsonl"
              onChange={(e) => setDatasetFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500/20 file:px-3 file:py-2 file:text-sky-300"
            />
            <button
              onClick={uploadDataset}
              disabled={isWorking}
              className="mt-4 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {busyAction === "upload" ? "Uploading..." : "Upload"}
            </button>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Generate From PDF</h2>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-500/20 file:px-3 file:py-2 file:text-violet-300"
            />
            <button
              onClick={generateDatasetFromPDF}
              disabled={isWorking}
              className="mt-4 rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
            >
              {busyAction === "pdf" ? "Generating..." : "Generate Dataset"}
            </button>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-5 lg:col-span-1">
            <h2 className="mb-3 text-sm font-semibold text-white">Start Fine-Tuning</h2>
            <div className="mb-3 rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs text-[#8b91a3]">
              Dataset:{" "}
              <span className="text-[#c8cdd8]">
                {datasetId || status.latestDataset?.id || "none selected"}
              </span>
            </div>
            <div className="mb-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[#6b7080]">HF Model</label>
                <input
                  value={trainingConfig.hfModel}
                  onChange={(e) =>
                    setTrainingConfig((prev) => ({ ...prev, hfModel: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/40"
                />
                <p className="mt-1 text-[10px] leading-relaxed text-[#6b7080]">
                  CPU-safe: sshleifer/tiny-gpt2. Use Qwen/Gemma only on CUDA GPU.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Steps", "trainingSteps", 1],
                  ["Max Examples", "maxExamples", 1],
                  ["Seq Length", "maxSeqLength", 16],
                  ["Batch", "batchSize", 1],
                  ["Grad Accum", "gradAccum", 1],
                  ["LoRA Rank", "loraR", 1],
                  ["LoRA Alpha", "loraAlpha", 1],
                ].map(([label, key, min]) => (
                  <div key={String(key)}>
                    <label className="mb-1 block text-xs text-[#6b7080]">{label}</label>
                    <input
                      type="number"
                      min={Number(min)}
                      value={trainingConfig[key as keyof typeof trainingConfig]}
                      onChange={(e) =>
                        setTrainingConfig((prev) => ({
                          ...prev,
                          [key]: numberValue(e.target.value, Number(min)),
                        }))
                      }
                      className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/40"
                    />
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-xs text-[#6b7080]">Learning Rate</label>
                  <input
                    type="number"
                    min={0.000001}
                    step={0.000001}
                    value={trainingConfig.learningRate}
                    onChange={(e) =>
                      setTrainingConfig((prev) => ({
                        ...prev,
                        learningRate: numberValue(e.target.value, 0.00005),
                      }))
                    }
                    className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-sky-500/40"
                  />
                </div>
              </div>
            </div>
            <button
              onClick={startTraining}
              disabled={isWorking || (!datasetId && !status.latestDataset)}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {busyAction === "train" ? "Starting..." : "Start Training"}
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-5">
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Remote Colab QLoRA Mode</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#9aa0b5]">
                Prepare a Google Colab package for real Qwen fine-tuning on GPU with Unsloth.
              </p>
            </div>
            <button
              onClick={prepareColabPackage}
              disabled={isWorking || (!datasetId && !status.latestDataset)}
              className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
            >
              {busyAction === "colab" ? "Preparing..." : "Prepare Colab Package"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs text-[#8b91a3]">Unsloth Base Model</label>
              <input
                value={remoteConfig.baseModel}
                onChange={(e) => setRemoteConfig((prev) => ({ ...prev, baseModel: e.target.value }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">Steps</label>
              <input
                type="number"
                min={1}
                value={remoteConfig.trainingSteps}
                onChange={(e) => setRemoteConfig((prev) => ({ ...prev, trainingSteps: numberValue(e.target.value, 60) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">LR</label>
              <input
                type="number"
                min={0.000001}
                step={0.000001}
                value={remoteConfig.learningRate}
                onChange={(e) => setRemoteConfig((prev) => ({ ...prev, learningRate: numberValue(e.target.value, 0.0002) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">Max Examples</label>
              <input
                type="number"
                min={1}
                value={remoteConfig.maxExamples}
                onChange={(e) => setRemoteConfig((prev) => ({ ...prev, maxExamples: numberValue(e.target.value, 500) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">Seq Length</label>
              <input
                type="number"
                min={128}
                value={remoteConfig.maxSeqLength}
                onChange={(e) => setRemoteConfig((prev) => ({ ...prev, maxSeqLength: numberValue(e.target.value, 1024) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">LoRA Rank</label>
              <input
                type="number"
                min={1}
                value={remoteConfig.loraR}
                onChange={(e) => setRemoteConfig((prev) => ({ ...prev, loraR: numberValue(e.target.value, 16) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">LoRA Alpha</label>
              <input
                type="number"
                min={1}
                value={remoteConfig.loraAlpha}
                onChange={(e) => setRemoteConfig((prev) => ({ ...prev, loraAlpha: numberValue(e.target.value, 16) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
              />
            </div>
            <div className="lg:col-span-4">
              <label className="mb-1 block text-xs text-[#8b91a3]">Drive Jobs Root</label>
              <input
                value={remoteConfig.driveRoot}
                onChange={(e) => setRemoteConfig((prev) => ({ ...prev, driveRoot: e.target.value }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
              />
            </div>
          </div>

          {colabPackage && (
            <div className="mt-4 rounded-lg border border-violet-500/20 bg-black/20 p-4 text-xs text-[#d6d8e4]">
              <div className="mb-2 font-semibold text-violet-300">Package Ready: {colabPackage.jobId}</div>
              <div>Export folder: {colabPackage.exportDir}</div>
              <div>Drive folder: {colabPackage.driveJobDir}</div>
              <div>Examples: {colabPackage.examplesExported}</div>
              <div className="mt-2 break-words">Notebook: {colabPackage.files?.notebook}</div>
            </div>
          )}
        </div>

        <div className="mb-6 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.055] p-5">
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Kaggle GPU Runner</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#9aa0b5]">
                Submit a private Kaggle Dataset plus GPU notebook from ModelForge, then download adapter outputs.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={prepareKagglePackage}
                disabled={isWorking || (!datasetId && !status.latestDataset)}
                className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
              >
                {busyAction === "kaggle" ? "Preparing..." : "Prepare"}
              </button>
              <button
                onClick={submitKagglePackage}
                disabled={isWorking || !kagglePackage?.jobId}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {busyAction === "kaggle-run" ? "Submitting..." : "Run"}
              </button>
              <button
                onClick={reloadKaggleStatus}
                disabled={isWorking || !kagglePackage?.jobId}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-[#c8cdd8] hover:border-cyan-500/30 hover:text-cyan-300 disabled:opacity-50"
              >
                {busyAction === "kaggle-status" ? "Checking..." : "Status"}
              </button>
              <button
                onClick={fetchKaggleOutput}
                disabled={isWorking || !kagglePackage?.jobId}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-[#c8cdd8] hover:border-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
              >
                {busyAction === "kaggle-download" ? "Downloading..." : "Download Output"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">Kaggle Username</label>
              <input
                value={kaggleConfig.kaggleUsername}
                onChange={(e) => setKaggleConfig((prev) => ({ ...prev, kaggleUsername: e.target.value }))}
                placeholder="your-kaggle-username"
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs text-[#8b91a3]">Unsloth Base Model</label>
              <input
                value={kaggleConfig.baseModel}
                onChange={(e) => setKaggleConfig((prev) => ({ ...prev, baseModel: e.target.value }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">Steps</label>
              <input
                type="number"
                min={1}
                value={kaggleConfig.trainingSteps}
                onChange={(e) => setKaggleConfig((prev) => ({ ...prev, trainingSteps: numberValue(e.target.value, 60) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">LR</label>
              <input
                type="number"
                min={0.000001}
                step={0.000001}
                value={kaggleConfig.learningRate}
                onChange={(e) => setKaggleConfig((prev) => ({ ...prev, learningRate: numberValue(e.target.value, 0.0002) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">Max Examples</label>
              <input
                type="number"
                min={1}
                value={kaggleConfig.maxExamples}
                onChange={(e) => setKaggleConfig((prev) => ({ ...prev, maxExamples: numberValue(e.target.value, 500) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">Seq Length</label>
              <input
                type="number"
                min={128}
                value={kaggleConfig.maxSeqLength}
                onChange={(e) => setKaggleConfig((prev) => ({ ...prev, maxSeqLength: numberValue(e.target.value, 1024) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">LoRA Rank</label>
              <input
                type="number"
                min={1}
                value={kaggleConfig.loraR}
                onChange={(e) => setKaggleConfig((prev) => ({ ...prev, loraR: numberValue(e.target.value, 16) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#8b91a3]">LoRA Alpha</label>
              <input
                type="number"
                min={1}
                value={kaggleConfig.loraAlpha}
                onChange={(e) => setKaggleConfig((prev) => ({ ...prev, loraAlpha: numberValue(e.target.value, 16) }))}
                className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
            </div>
          </div>

          {kagglePackage && (
            <div className="mt-4 rounded-lg border border-cyan-500/20 bg-black/20 p-4 text-xs text-[#d6d8e4]">
              <div className="mb-2 font-semibold text-cyan-300">Kaggle Job: {kagglePackage.jobId}</div>
              <div>Status: {kagglePackage.status}</div>
              <div className="break-words">Dataset: {kagglePackage.datasetRef}</div>
              <div className="break-words">Kernel: {kagglePackage.kernelRef}</div>
              <div>Examples: {kagglePackage.examplesExported}</div>
              <div className="break-words">Output: {kagglePackage.outputDir}</div>
              {kagglePackage.outputFiles?.length ? (
                <div className="mt-2 break-words">Files: {kagglePackage.outputFiles.join(", ")}</div>
              ) : null}
              {kagglePackage.message && (
                <div className="mt-2 text-cyan-200">{kagglePackage.message}</div>
              )}
            </div>
          )}
        </div>

        {latestJob && ["pending", "running"].includes(latestJob.status) && (
          <div className="mb-6 rounded-xl border border-sky-500/20 bg-sky-500/10 p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold text-sky-300">{latestJob.id}</span>
              <span className="text-sky-300">{latestJob.progress}%</span>
            </div>
            <ProgressBar value={latestJob.progress} />
            <div className="mt-2 text-xs text-[#8b91a3]">
              Step {latestJob.currentStep} / {latestJob.totalSteps}
            </div>
          </div>
        )}

        {(message || error) && (
          <div className={`mb-6 rounded-xl border p-4 text-sm ${error ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"}`}>
            {error || message}
          </div>
        )}

        {latestJob && (
          <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
            <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Latest Run Evidence</h2>
                <p className="mt-1 text-xs text-[#6b7080]">
                  {latestJob.id} | {latestJob.status} | {latestJob.datasetName}
                </p>
              </div>
              <button
                onClick={refreshStatus}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-[#c8cdd8] hover:border-sky-500/30 hover:text-sky-300"
              >
                Reload Evidence
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6b7080]">
                  Manifest
                </div>
                {artifacts?.manifest ? (
                  <div className="space-y-1 text-xs text-[#c8cdd8]">
                    <div>Status: {artifacts.manifest.status || "N/A"}</div>
                    {artifacts.manifest.message && (
                      <div className="text-sky-300">{artifacts.manifest.message}</div>
                    )}
                    <div>HF: {artifacts.manifest.hf_model || "N/A"}</div>
                    <div>Device: {artifacts.manifest.device || "N/A"}</div>
                    <div>Examples: {artifacts.manifest.examples_used ?? "N/A"}</div>
                    <div>Seq: {artifacts.manifest.max_seq_length ?? "N/A"}</div>
                    <div>Adapter: {artifacts.manifest.adapter_path || "N/A"}</div>
                  </div>
                ) : (
                  <div className="text-xs text-[#6b7080]">Manifest not written yet.</div>
                )}
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6b7080]">
                  LoRA
                </div>
                {artifacts?.manifest?.lora ? (
                  <div className="space-y-1 text-xs text-[#c8cdd8]">
                    <div>Rank: {artifacts.manifest.lora.r}</div>
                    <div>Alpha: {artifacts.manifest.lora.alpha}</div>
                    <div>Dropout: {artifacts.manifest.lora.dropout}</div>
                    <div className="break-words">
                      Targets: {artifacts.manifest.lora.target_modules?.join(", ")}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[#6b7080]">LoRA config appears after training saves.</div>
                )}
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6b7080]">
                  Metrics
                </div>
                {artifacts?.metrics?.length ? (
                  <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-[#c8cdd8]">
                    {artifacts.metrics.slice(-8).map((metric: any, index: number) => (
                      <div key={`${metric.step}-${index}`} className="flex justify-between gap-3">
                        <span>step {metric.step}</span>
                        <span className="text-sky-300">loss {metric.loss}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-[#6b7080]">Metrics stream starts when Trainer logs loss.</div>
                )}
              </div>
            </div>

            {artifacts?.manifest?.error && (
              <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                {artifacts.manifest.error}
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
          <div className="space-y-4">
            {steps.map((step, index) => {
              const Icon = step.icon;

              return (
                <div key={step.key} className="relative">
                  <div className="flex items-start gap-4 rounded-xl border border-white/[0.06] bg-[#111318] p-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10">
                      <Icon size={20} className="text-sky-400" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">
                          {index + 1}. {step.title}
                        </h3>
                        <StepBadge state={step.state} />
                      </div>
                      <p className="text-xs leading-relaxed text-[#8b91a3]">
                        {step.detail}
                      </p>
                    </div>
                  </div>

                  {index !== steps.length - 1 && (
                    <div className="ml-[22px] h-4 w-px bg-white/[0.1]" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
