// ─── Message Types ────────────────────────────────────────────────────────────
export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  model?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  model: ModelOption;
}

// ─── Model Types ──────────────────────────────────────────────────────────────
export type ModelOption = string;

export interface ModelCard {
  id: string;
  name: string;
  description: string;
  type: "base" | "finetuned";
  status: "ready" | "training" | "failed" | "pending";
  parameters: string;
  baseModel?: string;
  adapter?: string;
  adapterPath?: string;
  trainingJobId?: string;
  datasetId?: string;
  datasetName?: string;
  deployed?: boolean;
  deploymentId?: string;
  runtime?: string;
  runtimeModel?: string;
  defaultRuntimeModel?: string;
  deployReady?: boolean;
  deployBlocker?: string;
  artifactStatus?: string;
  adapterBase?: string;
  resolvedAdapterPath?: string;
  lastDeploymentStatus?: string;
  lastDeploymentMessage?: string;
  createdAt: Date;
  accuracy?: number;
}

// ─── Dataset Types ────────────────────────────────────────────────────────────
export type DatasetStatus = "uploaded" | "processing" | "ready" | "error";
export type DatasetFormat = "csv" | "jsonl";

export interface Dataset {
  id: string;
  name: string;
  format: DatasetFormat;
  size: string;
  rows: number;
  status: DatasetStatus;
  uploadedAt: Date;
}

// ─── Training Types ───────────────────────────────────────────────────────────
export type TrainingStatus = "pending" | "running" | "completed" | "failed";

export interface TrainingJob {
  id: string;
  name: string;
  baseModel: string;
  datasetId: string;
  datasetName: string;
  status: TrainingStatus;
  progress: number;
  currentStep: number;
  totalSteps: number;
  learningRate: number;
  startedAt?: Date;
  completedAt?: Date;
  lossHistory: number[];
}

export interface TrainingConfig {
  baseModel: string;
  datasetId: string;
  trainingSteps: number;
  learningRate: number;
  jobName: string;
  hfModel?: string;
  maxExamples?: number;
  maxSeqLength?: number;
  batchSize?: number;
  gradAccum?: number;
  loraR?: number;
  loraAlpha?: number;
}

// ─── Navigation Types ─────────────────────────────────────────────────────────
export type NavItem =
  | "chat"
  | "datasets"
  | "training"
  | "models"
  | "pipeline"
  | "rag"
  | "evaluation"
  | "deployment"
  | "settings";

export interface NavItemConfig {
  id: NavItem;
  label: string;
  icon: string;
  href: string;
}

// ─── API Response Types (for future FastAPI integration) ──────────────────────
export interface ApiResponse<T> {
  data: T;
  status: "success" | "error";
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
