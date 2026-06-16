"use client";

import { useEffect, useState } from "react";

export default function EvaluationPanel() {
  const [status, setStatus] = useState("Loading...");
  const [loss, setLoss] = useState<number[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadEvaluation = async () => {
      try {
        const res = await fetch(
          "http://localhost:8000/training-status"
        );

        const data = await res.json();

        setStatus(data.status || "Unknown");
        setLoss(data.loss || []);
      } catch {
        setError("Backend is not running.");
      }
    };

    loadEvaluation();
  }, []);

  return (
    <div className="p-6 text-black">
      <h1 className="text-2xl font-bold text-white">📊 Evaluation Dashboard</h1>

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-100 p-3 text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded border bg-white p-4">
          <h2 className="font-bold">Training Status</h2>
          <p>{status}</p>
        </div>

        <div className="rounded border bg-white p-4">
          <h2 className="font-bold">Final Loss</h2>
          <p>
            {loss.length > 0
              ? loss[loss.length - 1]
              : "N/A"}
          </p>
        </div>

        <div className="rounded border bg-white p-4">
          <h2 className="font-bold">Base Model</h2>
          <p>Qwen2.5-1.5B-Instruct</p>
        </div>

        <div className="rounded border bg-white p-4">
          <h2 className="font-bold">Fine-Tuned Model</h2>
          <p>ModelForge-Qwen-Math-LoRA</p>
        </div>
      </div>

      {loss.length > 0 && (
        <div className="mt-6 rounded border bg-white p-4">
          <h2 className="font-bold mb-2">Loss History</h2>

          <div className="flex gap-2">
            {loss.map((value, index) => (
              <div
                key={index}
                className="rounded bg-sky-100 px-3 py-2"
              >
                {value}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}