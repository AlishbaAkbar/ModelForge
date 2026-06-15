"use client";

import { useState, useEffect } from "react";
import { Save, CheckCircle, Globe, Moon, Info } from "lucide-react";
import { saveSettings, getBaseUrl } from "@/lib/api";

export default function SettingsPanel() {
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:8000");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setApiBaseUrl(getBaseUrl());
  }, []);

  const handleSave = async () => {
    setSaving(true);
    // TODO: Optionally validate the URL by pinging /health endpoint
    await saveSettings({ apiBaseUrl });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <h1
          className="text-xl font-bold text-white"
          style={{ fontFamily: "var(--font-display, 'Syne', sans-serif)" }}
        >
          Settings
        </h1>
        <p className="text-sm text-[#555a6e] mt-0.5">
          Configure your ModelForge backend connection
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">
        {/* API Connection */}
        <div className="forge-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <Globe size={14} className="text-sky-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                Backend Connection
              </h2>
              <p className="text-xs text-[#555a6e]">
                FastAPI server URL for model training and inference
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="forge-label block">API Base URL</label>
              <input
                type="url"
                className="forge-input"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="http://localhost:8000"
              />
            </div>

            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] flex gap-2">
              <Info size={13} className="text-[#555a6e] shrink-0 mt-0.5" />
              <div className="text-xs text-[#555a6e] space-y-1">
                <p>
                  This URL is used for all API calls:{" "}
                  <code className="inline-code">/api/chat</code>,{" "}
                  <code className="inline-code">/api/datasets</code>,{" "}
                  <code className="inline-code">/api/training</code>,{" "}
                  <code className="inline-code">/api/models</code>
                </p>
                <p>
                  Ensure your FastAPI server is running and CORS is configured
                  for{" "}
                  <code className="inline-code">http://localhost:3000</code>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="forge-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Moon size={14} className="text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Appearance</h2>
              <p className="text-xs text-[#555a6e]">
                Theme and display preferences
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between py-3 border-t border-white/[0.06]">
            <div>
              <div className="text-sm text-[#c8cdd8] font-medium">
                Dark Mode
              </div>
              <div className="text-xs text-[#555a6e]">
                Default and recommended for extended sessions
              </div>
            </div>
            {/* Toggle placeholder */}
            <div className="w-10 h-5 rounded-full bg-sky-500 flex items-center justify-end px-1 cursor-pointer">
              <div className="w-3.5 h-3.5 rounded-full bg-white shadow-sm" />
            </div>
          </div>
        </div>

        {/* API Endpoints Reference */}
        <div className="forge-card p-5">
          <h2 className="text-sm font-bold text-white mb-3">
            FastAPI Endpoint Reference
          </h2>
          <div className="space-y-2">
            {[
              { method: "POST", path: "/api/chat", desc: "Send chat message" },
              { method: "GET", path: "/api/datasets", desc: "List datasets" },
              {
                method: "POST",
                path: "/api/datasets/upload",
                desc: "Upload dataset",
              },
              {
                method: "GET",
                path: "/api/training/jobs",
                desc: "List training jobs",
              },
              {
                method: "POST",
                path: "/api/training/start",
                desc: "Start training job",
              },
              { method: "GET", path: "/api/models", desc: "List models" },
              {
                method: "POST",
                path: "/api/models/{id}/test",
                desc: "Test a model",
              },
            ].map((ep) => (
              <div
                key={ep.path}
                className="flex items-center gap-3 py-1.5 text-xs"
              >
                <span
                  className={`w-12 text-center font-bold rounded px-1.5 py-0.5 shrink-0 ${
                    ep.method === "GET"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-sky-500/10 text-sky-400"
                  }`}
                >
                  {ep.method}
                </span>
                <code className="text-[#8b90a0] font-mono">{ep.path}</code>
                <span className="text-[#3d4155]">{ep.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="forge-btn-primary"
          >
            {saved ? (
              <>
                <CheckCircle size={14} />
                Saved!
              </>
            ) : (
              <>
                <Save size={14} />
                {saving ? "Saving…" : "Save Settings"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
