"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Rocket, Server } from "lucide-react";
import { bindModelToOllamaRuntime, cleanTerminalText, deployModelToOllama, fetchModels } from "@/lib/api";
import type { ModelCard } from "@/types";

export default function DeploymentPanel() {
  const [models, setModels] = useState<ModelCard[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const adapters = useMemo(
    () => models.filter((model) => model.type === "finetuned"),
    [models]
  );

  const selected = adapters.find((model) => model.id === selectedModelId);
  const canDeploy = Boolean(selected?.deployReady);

  const loadModels = async () => {
    const data = await fetchModels();
    setModels(data);

    if (!selectedModelId) {
      const firstDeployable = data.find((model) => model.type === "finetuned" && model.deployReady);
      const firstAdapter = data.find((model) => model.type === "finetuned");
      const next = firstDeployable || firstAdapter;
      if (next) {
        setSelectedModelId(next.id);
        setOllamaModel(next.defaultRuntimeModel || next.runtimeModel || "");
      }
    }
  };

  useEffect(() => {
    loadModels().catch(() => {
      setError("Models could not be loaded. Make sure FastAPI is running.");
    });
  }, []);

  useEffect(() => {
    if (selected) {
      setOllamaModel(selected.defaultRuntimeModel || selected.runtimeModel || "");
    }
  }, [selected?.id]);

  const deploy = async () => {
    if (!selected) {
      setMessage("Select an adapter first.");
      return;
    }

    if (!selected.deployReady) {
      setMessage("");
      setError(selected.deployBlocker || "Selected adapter is not ready for deployment.");
      return;
    }

    setLoading(true);
    setMessage("");
    setError("");

    try {
      const result = await deployModelToOllama(selected.id, ollamaModel || selected.defaultRuntimeModel || "");
      setMessage(result.message || "Deployment registered.");
      await loadModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deployment failed.");
    } finally {
      setLoading(false);
    }
  };

  const bindExistingRuntime = async () => {
    if (!selected) {
      setMessage("Select an adapter first.");
      return;
    }

    if (!selected.deployReady) {
      setMessage("");
      setError(selected.deployBlocker || "Selected adapter is not ready for runtime binding.");
      return;
    }

    setLoading(true);
    setMessage("");
    setError("");

    try {
      const result = await bindModelToOllamaRuntime(
        selected.id,
        ollamaModel || selected.runtimeModel || "modelforge-qwen-math"
      );
      setMessage(result.message || "Existing Ollama runtime bound.");
      await loadModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Runtime binding failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
            Deployment
          </div>
          <h1 className="text-3xl font-bold text-white">Ollama Runtime Binding</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#8b91a3]">
            Deploy a valid Qwen LoRA adapter into Ollama. Chat and model tests only use deployed runtimes.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-5 lg:col-span-2">
            <div className="mb-4 flex items-center gap-3">
              <Rocket size={18} className="text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">Create Ollama Model</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[#8b91a3]">Fine-tuned Adapter</label>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
                >
                  {adapters.length === 0 && <option value="">No adapters registered</option>}
                  {adapters.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} {model.deployReady ? "(deploy ready)" : "(blocked)"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#8b91a3]">Ollama Model Name</label>
                <input
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  placeholder={selected?.defaultRuntimeModel || "modelforge-custom-model"}
                  className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
                />
              </div>

              {selected && !selected.deployReady && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                  {selected.deployBlocker || "This adapter is blocked from Ollama deployment."}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={deploy}
                  disabled={loading || !selectedModelId || !canDeploy}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Deploying..." : "Deploy to Ollama"}
                </button>
                <button
                  onClick={bindExistingRuntime}
                  disabled={loading || !selectedModelId || !canDeploy}
                  className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Bind Existing Runtime
                </button>
              </div>
              <p className="text-xs leading-relaxed text-[#8b91a3]">
                Use deploy to create a new Ollama model. Use bind when the Ollama model already exists locally, for example modelforge-qwen-math.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
            <div className="mb-4 flex items-center gap-3">
              <Server size={18} className="text-sky-400" />
              <h2 className="text-sm font-semibold text-white">Selected Adapter</h2>
            </div>
            {selected ? (
              <div className="space-y-2 text-xs text-[#c8cdd8]">
                <div className="font-semibold text-white">{selected.name}</div>
                <div>Base: {selected.baseModel || "N/A"}</div>
                <div>Adapter base: {selected.adapterBase || "N/A"}</div>
                <div>Artifact: {selected.artifactStatus || "N/A"}</div>
                <div>Deploy ready: {selected.deployReady ? "Yes" : "No"}</div>
                <div>Runtime: {selected.deployed ? selected.runtimeModel : "Not deployed"}</div>
                {selected.lastDeploymentStatus && (
                  <div>Last deployment: {selected.lastDeploymentStatus}</div>
                )}
                {selected.lastDeploymentStatus === "failed" && selected.lastDeploymentMessage && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-red-200">
                    {cleanTerminalText(selected.lastDeploymentMessage)}
                  </div>
                )}
                <div className="break-words">Adapter: {selected.resolvedAdapterPath || selected.adapter || "N/A"}</div>
              </div>
            ) : (
              <div className="text-xs text-[#6b7080]">No adapter selected.</div>
            )}
          </div>
        </div>

        {(message || error) && (
          <div
            className={`mt-6 flex items-start gap-2 rounded-xl border p-4 text-sm ${
              error
                ? "border-red-500/20 bg-red-500/10 text-red-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{cleanTerminalText(error || message)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
