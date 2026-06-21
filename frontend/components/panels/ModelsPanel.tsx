"use client";

import { useState } from "react";
import { FileText, Layers, Loader, Play, Rocket, Send, X, Zap } from "lucide-react";
import { cleanTerminalText, deployModelToOllama, fetchModelDetails, importAdapter, testModel } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import type { ModelCard } from "@/types";

interface ModelsPanelProps {
  models: ModelCard[];
  onModelsChanged?: () => void | Promise<void>;
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

function DeployBadge({ model }: { model: ModelCard }) {
  if (model.deployed) {
    return (
      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
        Deployed
      </span>
    );
  }

  if (model.deployReady) {
    return (
      <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-300">
        Deploy Ready
      </span>
    );
  }

  return (
    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
      Deploy Blocked
    </span>
  );
}

function TestPanel({ model, onClose }: { model: ModelCard; onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setResponse("");

    try {
      const result = await testModel(model.id, prompt);
      setResponse(result);
    } catch (e) {
      setResponse(e instanceof Error ? e.message : "Model test failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 p-4 animate-slide-up">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8b90a0]">
          Test Model
        </span>
        <button onClick={onClose} className="text-[#3d4155] hover:text-[#8b90a0]">
          <X size={13} />
        </button>
      </div>

      <div className="mb-3 flex gap-2">
        <input
          className="forge-input flex-1 text-xs"
          placeholder="Enter a test prompt..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleTest()}
        />
        <button
          onClick={handleTest}
          disabled={loading || !prompt.trim()}
          className="forge-btn-primary px-3"
        >
          {loading ? <Loader size={13} className="animate-spin" /> : <Send size={13} />}
        </button>
      </div>

      {response && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 font-mono text-xs leading-relaxed text-[#c8cdd8] whitespace-pre-wrap">
          {response}
        </div>
      )}
    </div>
  );
}

export default function ModelsPanel({ models, onModelsChanged }: ModelsPanelProps) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [details, setDetails] = useState<any>(null);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [adapterFile, setAdapterFile] = useState<File | null>(null);
  const [adapterName, setAdapterName] = useState("");
  const [importing, setImporting] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  const baseModels = models.filter((model) => model.type === "base");
  const fineTunedModels = models.filter((model) => model.type === "finetuned");
  const deployReadyModels = fineTunedModels.filter((model) => model.deployReady);
  const deployedModels = fineTunedModels.filter((model) => model.deployed);

  const loadDetails = async (model: ModelCard) => {
    if (detailsId === model.id) {
      setDetailsId(null);
      setDetails(null);
      return;
    }

    setActionMessage("");
    setActionError("");

    try {
      setDetails(await fetchModelDetails(model.id));
      setDetailsId(model.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Model details failed to load.");
    }
  };

  const deployModel = async (model: ModelCard) => {
    if (!model.deployReady) {
      setActionMessage("");
      setActionError(model.deployBlocker || "This adapter is not ready for Ollama deployment.");
      return;
    }

    setDeployingId(model.id);
    setActionMessage("");
    setActionError("");

    try {
      const result = await deployModelToOllama(model.id, model.defaultRuntimeModel || "");
      setActionMessage(result.message || "Model deployed.");
      await onModelsChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Deployment failed.");
    } finally {
      setDeployingId(null);
    }
  };

  const uploadAdapter = async () => {
    if (!adapterFile) {
      setActionMessage("Select adapter.zip first.");
      return;
    }

    setImporting(true);
    setActionMessage("");
    setActionError("");

    try {
      const result = await importAdapter(adapterFile, { modelName: adapterName });
      setActionMessage(result.message || "Adapter imported.");
      setAdapterFile(null);
      setAdapterName("");
      await onModelsChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Adapter import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <div className="border-b border-white/[0.06] px-6 py-5">
        <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-display, 'Syne', sans-serif)" }}>
          My Models
        </h1>
        <p className="mt-0.5 text-sm text-[#555a6e]">
          {baseModels.length} base | {fineTunedModels.length} adapters | {deployReadyModels.length} deploy ready |{" "}
          {deployedModels.length} deployed
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-5">
          <div className="mb-2 text-sm font-semibold text-white">Import Qwen Adapter</div>
          <p className="mb-3 text-xs leading-relaxed text-[#8b91a3]">
            Import the adapter.zip produced by Kaggle or remote QLoRA. Imported adapters become registered models first, then can be deployed to Ollama for chat/testing.
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto]">
            <input
              type="file"
              accept=".zip"
              onChange={(e) => setAdapterFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500/20 file:px-3 file:py-2 file:text-sky-300"
            />
            <input
              value={adapterName}
              onChange={(e) => setAdapterName(e.target.value)}
              placeholder="Custom Model - Dataset A"
              className="rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/40"
            />
            <button
              onClick={uploadAdapter}
              disabled={importing}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import"}
            </button>
          </div>
        </div>

        {(actionMessage || actionError) && (
          <div
            className={cn(
              "rounded-xl border p-4 text-sm",
              actionError
                ? "border-red-500/20 bg-red-500/10 text-red-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
            )}
          >
            {cleanTerminalText(actionError || actionMessage)}
          </div>
        )}

        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#3d4155]">
            Base Models
          </div>
          {baseModels.map((model) => (
            <div key={model.id} className="forge-card p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04]">
                  <Layers size={18} className="text-[#6b7080]" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">{model.name}</h3>
                    <StatusBadge status={model.status} />
                  </div>
                  <p className="mb-3 text-xs leading-relaxed text-[#555a6e]">{model.description}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-[#3d4155]">
                    <span className="rounded border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                      {model.parameters} params
                    </span>
                    <span className="rounded border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                      Ollama runtime
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setTestingId(testingId === model.id ? null : model.id)}
                  disabled={model.status !== "ready"}
                  className={cn(
                    "forge-btn-secondary shrink-0 text-xs",
                    testingId === model.id && "border-sky-500/20 bg-sky-500/10 text-sky-400"
                  )}
                >
                  <Play size={12} />
                  Test
                </button>
              </div>
              {testingId === model.id && <TestPanel model={model} onClose={() => setTestingId(null)} />}
            </div>
          ))}
        </div>

        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#3d4155]">
            Fine-tuned Adapters
          </div>
          {fineTunedModels.map((model) => {
            const canTest = Boolean(model.deployed && model.runtimeModel);
            const canDeploy = Boolean(model.deployReady);

            return (
              <div
                key={model.id}
                className={cn(
                  "forge-card mb-3 p-5",
                  model.status === "ready" && "transition-all duration-200 hover:border-sky-500/20"
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                      model.status === "ready"
                        ? "border-sky-500/20 bg-sky-500/10"
                        : "border-white/[0.07] bg-white/[0.03]"
                    )}
                  >
                    <Zap size={18} className={model.status === "ready" ? "text-sky-400" : "text-[#3d4155]"} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-white">{model.name}</h3>
                      <StatusBadge status={model.status} />
                      <DeployBadge model={model} />
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-[#555a6e]">{model.description}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-[#3d4155]">
                      {model.baseModel && (
                        <span className="rounded border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                          Base: {model.baseModel}
                        </span>
                      )}
                      <span className="rounded border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                        {model.deployed ? `Runtime: ${model.runtimeModel}` : "Registered adapter"}
                      </span>
                      {model.defaultRuntimeModel && (
                        <span className="rounded border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                          Deploy name: {model.defaultRuntimeModel}
                        </span>
                      )}
                      {model.adapterBase && (
                        <span className="rounded border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                          Adapter base: {model.adapterBase}
                        </span>
                      )}
                      {model.artifactStatus && (
                        <span className="rounded border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                          Artifact: {model.artifactStatus}
                        </span>
                      )}
                      <span className="rounded border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                        Created {formatDate(model.createdAt)}
                      </span>
                    </div>
                    {!model.deployed && !model.deployReady && model.deployBlocker && (
                      <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                        {model.deployBlocker}
                      </div>
                    )}
                    {model.lastDeploymentStatus === "failed" && model.lastDeploymentMessage && (
                      <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
                        Last deployment failed: {model.lastDeploymentMessage}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setTestingId(testingId === model.id ? null : model.id)}
                    disabled={!canTest}
                    className={cn(
                      "shrink-0 text-xs",
                      canTest
                        ? testingId === model.id
                          ? "forge-btn-primary"
                          : "forge-btn-secondary"
                        : "forge-btn-ghost cursor-not-allowed opacity-40"
                    )}
                  >
                    <Play size={12} />
                    {canTest ? "Test" : "Deploy first"}
                  </button>
                  <button onClick={() => loadDetails(model)} className="forge-btn-secondary shrink-0 text-xs">
                    <FileText size={12} />
                    Details
                  </button>
                  <button
                    onClick={() => deployModel(model)}
                    disabled={deployingId === model.id || !canDeploy}
                    className={cn("forge-btn-secondary shrink-0 text-xs", !canDeploy && "cursor-not-allowed opacity-45")}
                  >
                    {deployingId === model.id ? <Loader size={12} className="animate-spin" /> : <Rocket size={12} />}
                    {!canDeploy ? "Blocked" : model.deployed ? "Redeploy" : "Deploy"}
                  </button>
                </div>

                {testingId === model.id && canTest && <TestPanel model={model} onClose={() => setTestingId(null)} />}

                {detailsId === model.id && details && (
                  <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 p-4 text-xs text-[#c8cdd8]">
                    <div className="mb-2 font-semibold text-white">Training Details</div>
                    <div>Job: {details.trainingJob?.id || model.trainingJobId || "N/A"}</div>
                    <div>Dataset: {details.dataset?.name || model.datasetName || "N/A"}</div>
                    <div>Base: {model.baseModel || "N/A"}</div>
                    <div>Deploy ready: {model.deployReady ? "Yes" : "No"}</div>
                    {!model.deployReady && model.deployBlocker && (
                      <div className="mt-1 text-amber-300">Blocker: {model.deployBlocker}</div>
                    )}
                    <div className="break-words">Adapter: {model.resolvedAdapterPath || model.adapterPath || "N/A"}</div>
                    <div className="mt-3 mb-1 font-semibold text-white">Deployments</div>
                    {details.deployments?.length ? (
                      <div className="space-y-1">
                        {details.deployments.map((deployment: any) => (
                          <div key={deployment.id}>
                            {deployment.id} | {deployment.status} | {deployment.runtimeModel}
                            {deployment.summary ? ` | ${deployment.summary}` : ""}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div>No deployments yet.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
