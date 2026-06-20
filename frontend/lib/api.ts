import type {
  ChatMessage,
  Dataset,
  TrainingJob,
  TrainingConfig,
  ModelCard,
  ApiResponse,
} from "@/types";

// ─── Config ───────────────────────────────────────────────────────────────────
const getBaseUrl = () => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("apiBaseUrl") || "http://127.0.0.1:8000";
  }
  return "http://127.0.0.1:8000";
};

// ─── Chat API ─────────────────────────────────────────────────────────────────
export async function sendChatMessage(
  message: string,
  model: string,
  sessionId: string
): Promise<ChatMessage> {
  const baseUrl = getBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        model,
        session_id: sessionId,
      }),
    });

    if (!response.ok) {
      throw new Error("Backend returned an error.");
    }

    const data = await response.json();

    return {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content:
        data.response ||
        "No response returned from backend. Please check Ollama/model.",
      timestamp: new Date(),
      model:
        data.model_used ||
        (model === "finetuned-model"
          ? "ModelForge-Qwen-Math-LoRA"
          : "Base Qwen2.5-1.5B-Instruct"),
    };
  } catch {
    return {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content:
        "Backend is not reachable. Please make sure FastAPI is running on http://127.0.0.1:8000 and Ollama is running.",
      timestamp: new Date(),
      model:
        model === "finetuned-model"
          ? "ModelForge-Qwen-Math-LoRA"
          : "Base Qwen2.5-1.5B-Instruct",
    };
  }
}

// ─── Dataset API ──────────────────────────────────────────────────────────────
export async function fetchDatasets(): Promise<Dataset[]> {
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/datasets`);

  if (!response.ok) {
    throw new Error("Failed to fetch datasets");
  }

  const data = await response.json();

  return data.map((d: any) => ({
    id: d.id,
    name: d.name,
    format: d.format,
    size: d.size || "N/A",
    rows: d.rows_count ?? d.rows ?? 0,
    status: d.status || "ready",
    uploadedAt: new Date(d.uploadedAt || d.uploaded_at || Date.now()),
  }));
}

export async function uploadDataset(
  file: File
): Promise<ApiResponse<Dataset>> {
  const baseUrl = getBaseUrl();

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${baseUrl}/upload-dataset`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || data.status === "error") {
    return {
      status: "error",
      data: {} as Dataset,
      message: data.message || "Dataset upload failed",
    };
  }

  const uploaded = data.dataset;

  const newDataset: Dataset = {
    id: uploaded?.id || `ds-${Date.now()}`,
    name: uploaded?.name || data.filename || file.name,
    format: uploaded?.format || (file.name.split(".").pop()?.toLowerCase() as any),
    size: `${(file.size / 1024).toFixed(0)} KB`,
    rows: uploaded?.rows_count ?? 0,
    status: "ready",
    uploadedAt: new Date(uploaded?.uploadedAt || Date.now()),
  };

  return {
    status: "success",
    data: newDataset,
    message: data.message || "Dataset uploaded successfully",
  };
}

export async function deleteDataset(id: string): Promise<void> {
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/datasets/${id}`, {
    method: "DELETE",
  });

  const data = await response.json();

  if (!response.ok || data.status === "error") {
    throw new Error(data.message || "Dataset delete failed");
  }
}

// ─── Training API ─────────────────────────────────────────────────────────────
export async function fetchTrainingJobs(): Promise<TrainingJob[]> {
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/training/jobs`);

  if (!response.ok) {
    throw new Error("Failed to fetch training jobs");
  }

  const data = await response.json();

  return data.map((j: any) => ({
    id: j.id,
    name: j.name || "ModelForge Training Job",
    baseModel: j.baseModel || j.base_model || "Qwen2.5-1.5B-Instruct",
    datasetId: j.datasetId || j.dataset_id || "",
    datasetName: j.datasetName || "Uploaded Dataset",
    status: j.status || "pending",
    progress: j.progress ?? 0,
    currentStep: j.currentStep ?? 0,
    totalSteps: j.totalSteps ?? j.training_steps ?? 0,
    learningRate: j.learningRate ?? j.learning_rate ?? 0,
    startedAt: new Date(j.startedAt || j.created_at || Date.now()),
    completedAt: j.completedAt ? new Date(j.completedAt) : undefined,
    lossHistory: j.lossHistory || [],
  }));
}

export async function startTrainingJob(
  config: TrainingConfig
): Promise<ApiResponse<TrainingJob>> {
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/start-training`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  const data = await response.json();

  if (!response.ok || data.status === "error") {
    return {
      status: "error",
      data: {} as TrainingJob,
      message: data.message || "Training failed to start",
    };
  }

  const job = data.data;

  return {
    status: "success",
    data: {
      id: job.id,
      name: job.name,
      baseModel: job.baseModel,
      datasetId: job.datasetId,
      datasetName: job.datasetName,
      status: job.status,
      progress: job.progress,
      currentStep: job.currentStep,
      totalSteps: job.totalSteps,
      learningRate: job.learningRate,
      startedAt: new Date(job.startedAt),
      lossHistory: job.lossHistory || [],
    },
    message: data.message,
  };
}

export async function fetchJobStatus(jobId: string): Promise<TrainingJob | null> {
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/training/jobs/${jobId}`);

  if (!response.ok) {
    return null;
  }

  const j = await response.json();

  if (j.status === "error") return null;

  return {
    id: j.id,
    name: j.name || "ModelForge Training Job",
    baseModel: j.baseModel,
    datasetId: j.datasetId,
    datasetName: j.datasetName,
    status: j.status,
    progress: j.progress,
    currentStep: j.currentStep,
    totalSteps: j.totalSteps,
    learningRate: j.learningRate,
    startedAt: new Date(j.startedAt),
    lossHistory: j.lossHistory || [],
  };
}

// ─── Models API ───────────────────────────────────────────────────────────────
export async function fetchTrainingArtifacts(jobId: string): Promise<any> {
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/training/jobs/${jobId}/artifacts`);

  if (!response.ok) {
    throw new Error("Failed to fetch training artifacts");
  }

  return response.json();
}

export async function fetchModels(): Promise<ModelCard[]> {
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/models`);

  if (!response.ok) {
    throw new Error("Failed to fetch models");
  }

  const data = await response.json();

  return data.map((m: any) => ({
    id: m.id,
    name: m.name,
    description:
      m.description ||
      (m.type === "adapter"
        ? "Fine-tuned local GGUF model served through Ollama."
        : "Base model available for comparison."),
    type: m.type === "adapter" ? "finetuned" : m.type,
    status: m.status === "available" ? "ready" : m.status || "ready",
    parameters: m.parameters || "1.5B",
    baseModel: m.baseModel || m.base_model,
    adapter: m.adapter,
    createdAt: new Date(),
    accuracy: m.accuracy,
  }));
}

export async function testModel(
  modelId: string,
  prompt: string
): Promise<string> {
  const msg = await sendChatMessage(prompt, modelId, `test-${Date.now()}`);
  return msg.content;
}

// ─── RAG API ──────────────────────────────────────────────────────────────────
export async function uploadRagDocument(file: File): Promise<any> {
  const baseUrl = getBaseUrl();

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${baseUrl}/rag/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || data.status === "error") {
      throw new Error(data.message || "RAG document upload failed");
    }

    return data;
  } catch {
    return {
      status: "error",
      message:
        "RAG upload failed. Make sure FastAPI is running and the file is a valid PDF.",
    };
  }
}

export async function queryRag(question: string, topK = 2): Promise<any> {
  const baseUrl = getBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/rag/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        top_k: topK,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.status === "error") {
      throw new Error(data.message || "RAG query failed");
    }

    return data;
  } catch {
    return {
      status: "error",
      answer:
        "RAG query failed. Please upload a PDF first and make sure Ollama is running.",
      sources: [],
    };
  }
}
export async function generateTrainingDataset(file: File): Promise<any> {
  const baseUrl = getBaseUrl();

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${baseUrl}/generate-training-dataset`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    return data;
  } catch {
    return {
      status: "error",
      message: "Dataset generation failed. Make sure backend is running.",
    };
  }
}

// ─── Settings API ─────────────────────────────────────────────────────────────
export async function fetchPipelineStatus(): Promise<any> {
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/pipeline/status`);

  if (!response.ok) {
    throw new Error("Failed to fetch pipeline status");
  }

  return response.json();
}

export async function saveSettings(settings: {
  apiBaseUrl: string;
}): Promise<void> {
  if (typeof window !== "undefined") {
    localStorage.setItem("apiBaseUrl", settings.apiBaseUrl);
  }
}

export { getBaseUrl };
