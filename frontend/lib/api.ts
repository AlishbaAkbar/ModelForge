/**
 * ModelForge API Client
 *
 * All functions are mocked for now. When connecting to FastAPI backend,
 * replace the mock implementations with real fetch calls.
 *
 * Base URL is configurable via settings → stored in localStorage.
 * Default: http://localhost:8000
 */

import type {
  ChatMessage,
  Dataset,
  TrainingJob,
  TrainingConfig,
  ModelCard,
  ApiResponse,
} from "@/types";
import {
  mockDatasets,
  mockTrainingJobs,
  mockModels,
} from "@/lib/mockData";

// ─── Config ───────────────────────────────────────────────────────────────────
const getBaseUrl = () => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("apiBaseUrl") || "http://localhost:8000";
  }
  return "http://localhost:8000";
};

const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── Chat API ─────────────────────────────────────────────────────────────────

/**
 * Send a message to the model.
 * TODO: Replace with: POST {baseUrl}/api/chat
 * Body: { message, model, session_id }
 */
export async function sendChatMessage(
  message: string,
  model: string,
  sessionId: string
): Promise<ChatMessage> {

  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      model,
      session_id: sessionId,
    }),
  });

  const data = await response.json();

  return {
    id: `msg-${Date.now()}`,
    role: "assistant",
    content: data.response,
    timestamp: new Date(),
    model:
      model === "finetuned-model"
        ? "ModelForge-Qwen-Math-LoRA"
        : "Base Qwen2.5-1.5B-Instruct",
  };
}

// ─── Dataset API ──────────────────────────────────────────────────────────────

/**
 * Fetch all datasets.
 * TODO: Replace with: GET {baseUrl}/api/datasets
 */
export async function fetchDatasets(): Promise<Dataset[]> {
  await delay(500);
  return [...mockDatasets];
}

/**
 * Upload a dataset file.
 * TODO: Replace with: POST {baseUrl}/api/datasets/upload (multipart/form-data)
 */
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

  if (!response.ok) {
    return {
      status: "error",
      data: {} as Dataset,
      message: data.message || "Dataset upload failed",
    };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() as "csv" | "jsonl";

  const newDataset: Dataset = {
    id: `ds-${Date.now()}`,
    name: data.filename,
    format: ext,
    size: `${(file.size / 1024).toFixed(0)} KB`,
    rows: 0,
    status: "ready",
    uploadedAt: new Date(),
  };

  return {
    status: "success",
    data: newDataset,
    message: data.message,
  };
}

/**
 * Delete a dataset.
 * TODO: Replace with: DELETE {baseUrl}/api/datasets/{id}
 */
export async function deleteDataset(id: string): Promise<void> {
  await delay(400);
  console.log(`[MOCK] Deleted dataset: ${id}`);
}

// ─── Training API ─────────────────────────────────────────────────────────────

/**
 * Fetch all training jobs.
 * TODO: Replace with: GET {baseUrl}/api/training/jobs
 */
export async function fetchTrainingJobs(): Promise<TrainingJob[]> {
  await delay(600);
  return [...mockTrainingJobs];
}

/**
 * Start a new training job.
 * TODO: Replace with: POST {baseUrl}/api/training/start
 * Body: TrainingConfig
 */
export async function startTrainingJob(
  config: TrainingConfig
): Promise<ApiResponse<TrainingJob>> {
  await delay(1000);

  const newJob: TrainingJob = {
    id: `job-${Date.now()}`,
    name: config.jobName,
    baseModel: config.baseModel,
    datasetId: config.datasetId,
    datasetName: "Selected Dataset",
    status: "pending",
    progress: 0,
    currentStep: 0,
    totalSteps: config.trainingSteps,
    learningRate: config.learningRate,
    startedAt: new Date(),
    lossHistory: [],
  };

  return { status: "success", data: newJob };
}

/**
 * Fetch training job status.
 * TODO: Replace with: GET {baseUrl}/api/training/jobs/{id}
 */
export async function fetchJobStatus(jobId: string): Promise<TrainingJob | null> {
  await delay(300);
  return mockTrainingJobs.find((j) => j.id === jobId) || null;
}

// ─── Models API ───────────────────────────────────────────────────────────────

/**
 * Fetch all models.
 * TODO: Replace with: GET {baseUrl}/api/models
 */
export async function fetchModels(): Promise<ModelCard[]> {
  await delay(500);
  return [...mockModels];
}

/**
 * Test a model with a prompt.
 * TODO: Replace with: POST {baseUrl}/api/models/{id}/test
 * Body: { prompt }
 */
export async function testModel(
  modelId: string,
  prompt: string
): Promise<string> {
  await delay(1000);
  return `[Test response from ${modelId}]\n\nYou asked: "${prompt}"\n\nThis is a simulated response from the fine-tuned model. In production, this will call your deployed Gemma adapter via the FastAPI inference endpoint.`;
}

// ─── Settings API ─────────────────────────────────────────────────────────────

/**
 * Save settings.
 * TODO: Replace with: PUT {baseUrl}/api/settings
 */
export async function saveSettings(settings: {
  apiBaseUrl: string;
}): Promise<void> {
  await delay(300);
  if (typeof window !== "undefined") {
    localStorage.setItem("apiBaseUrl", settings.apiBaseUrl);
  }
}

export { getBaseUrl };
