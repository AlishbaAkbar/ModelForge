"use client";

export default function DeploymentPanel() {
  return (
    <div className="p-6 text-white">
      <h1 className="text-2xl font-bold">🚀 Deployment Dashboard</h1>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded border bg-white p-4 text-black">
          <h2 className="font-bold">Status</h2>
          <p>Running</p>
        </div>

        <div className="rounded border bg-white p-4 text-black">
          <h2 className="font-bold">Runtime</h2>
          <p>Ollama</p>
        </div>

        <div className="rounded border bg-white p-4 text-black">
          <h2 className="font-bold">Model</h2>
          <p>ModelForge-Qwen-Math-LoRA</p>
        </div>

        <div className="rounded border bg-white p-4 text-black">
          <h2 className="font-bold">Quantization</h2>
          <p>GGUF Q4_K_M</p>
        </div>

        <div className="rounded border bg-white p-4 text-black">
          <h2 className="font-bold">Endpoint</h2>
          <p>/chat</p>
        </div>

        <div className="rounded border bg-white p-4 text-black">
          <h2 className="font-bold">Deployment Type</h2>
          <p>Local LLM</p>
        </div>
      </div>
    </div>
  );
}