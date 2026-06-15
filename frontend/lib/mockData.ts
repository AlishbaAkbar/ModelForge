import type {
  ChatSession,
  Dataset,
  TrainingJob,
  ModelCard,
} from "@/types";

// ─── Mock Chat Sessions ───────────────────────────────────────────────────────
export const mockChatSessions: ChatSession[] = [
  {
    id: "session-1",
    title: "Fine-tuning Gemma for customer support",
    model: "finetuned-model",
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-01-15"),
    messages: [
      {
        id: "msg-1",
        role: "user",
        content:
          "How do I fine-tune Gemma for my customer support use case?",
        timestamp: new Date("2024-01-15T10:00:00"),
      },
      {
        id: "msg-2",
        role: "assistant",
        content:
          "Great question! To fine-tune Gemma for customer support, you'll want to follow these steps:\n\n**1. Prepare Your Dataset**\nUpload a JSONL file with prompt-completion pairs from your support tickets. Aim for at least 500-1000 examples.\n\n**2. Configure Training**\nStart with:\n- Training steps: 500-1000\n- Learning rate: 2e-4\n- Use LoRA adapters for efficient fine-tuning\n\n**3. Evaluate Results**\nTest the fine-tuned model with sample queries to verify it matches your support tone and accurately resolves issues.\n\nWould you like me to walk you through the dataset upload process?",
        timestamp: new Date("2024-01-15T10:00:05"),
        model: "Fine-tuned Gemma 2B",
      },
    ],
  },
  {
    id: "session-2",
    title: "Dataset format questions",
    model: "base-gemma",
    createdAt: new Date("2024-01-14"),
    updatedAt: new Date("2024-01-14"),
    messages: [
      {
        id: "msg-3",
        role: "user",
        content: "What format should my training data be in?",
        timestamp: new Date("2024-01-14T09:00:00"),
      },
      {
        id: "msg-4",
        role: "assistant",
        content:
          "ModelForge supports two primary formats:\n\n**JSONL (Recommended)**\nEach line is a JSON object:\n```json\n{\"prompt\": \"User question\", \"completion\": \"Ideal response\"}\n```\n\n**CSV**\nTwo columns: `prompt` and `completion`\n\nFor best results, ensure your data is clean, diverse, and representative of real use cases.",
        timestamp: new Date("2024-01-14T09:00:08"),
        model: "Base Qwen2.5-1.5B-Instruct 2B",
      },
    ],
  },
  {
    id: "session-3",
    title: "LoRA adapter configuration",
    model: "base-gemma",
    createdAt: new Date("2024-01-13"),
    updatedAt: new Date("2024-01-13"),
    messages: [],
  },
];

// ─── Mock Datasets ────────────────────────────────────────────────────────────
export const mockDatasets: Dataset[] = [
  {
    id: "ds-1",
    name: "customer_support_v2.jsonl",
    format: "jsonl",
    size: "2.4 MB",
    rows: 1842,
    status: "ready",
    uploadedAt: new Date("2024-01-14"),
  },
  {
    id: "ds-2",
    name: "faq_training_data.csv",
    format: "csv",
    size: "890 KB",
    rows: 654,
    status: "ready",
    uploadedAt: new Date("2024-01-12"),
  },
  {
    id: "ds-3",
    name: "product_qa_dataset.jsonl",
    format: "jsonl",
    size: "5.1 MB",
    rows: 3210,
    status: "processing",
    uploadedAt: new Date("2024-01-15"),
  },
];

// ─── Mock Training Jobs ───────────────────────────────────────────────────────
export const mockTrainingJobs: TrainingJob[] = [
  {
    id: "job-1",
    name: "ModelForge-Gemma-Support-v1",
    baseModel: "Gemma 2B",
    datasetId: "ds-1",
    datasetName: "customer_support_v2.jsonl",
    status: "completed",
    progress: 100,
    currentStep: 1000,
    totalSteps: 1000,
    learningRate: 0.0002,
    startedAt: new Date("2024-01-14T10:00:00"),
    completedAt: new Date("2024-01-14T11:23:00"),
    lossHistory: [
      2.8, 2.5, 2.2, 2.0, 1.85, 1.7, 1.6, 1.52, 1.45, 1.38, 1.32, 1.27,
      1.22, 1.18, 1.14, 1.1, 1.07, 1.04, 1.02, 0.99,
    ],
  },
  {
    id: "job-2",
    name: "ModelForge-Gemma-FAQ-v1",
    baseModel: "Gemma 2B",
    datasetId: "ds-2",
    datasetName: "faq_training_data.csv",
    status: "running",
    progress: 62,
    currentStep: 620,
    totalSteps: 1000,
    learningRate: 0.0001,
    startedAt: new Date("2024-01-15T08:30:00"),
    lossHistory: [
      2.9, 2.6, 2.3, 2.1, 1.9, 1.75, 1.62, 1.51, 1.42, 1.35, 1.28, 1.22,
    ],
  },
  {
    id: "job-3",
    name: "ModelForge-Gemma-Product-v1",
    baseModel: "Gemma 2B",
    datasetId: "ds-3",
    datasetName: "product_qa_dataset.jsonl",
    status: "pending",
    progress: 0,
    currentStep: 0,
    totalSteps: 500,
    learningRate: 0.0002,
    lossHistory: [],
  },
];

// ─── Mock Models ──────────────────────────────────────────────────────────────
export const mockModels: ModelCard[] = [
  {
    id: "model-base",
    name: "Gemma 2B",
    description:
      "Google's open-source 2B parameter language model. Use as a base for fine-tuning on your custom datasets.",
    type: "base",
    status: "ready",
    parameters: "2B",
    createdAt: new Date("2024-01-01"),
  },
  {
    id: "model-ft-1",
    name: "ModelForge-Qwen-Math-LoRA",
    description:
      "Fine-tuned Gemma 2B with LoRA adapters on customer support dataset. Optimized for support ticket resolution.",
    type: "finetuned",
    status: "ready",
    parameters: "2B + LoRA",
    baseModel: "Gemma 2B",
    adapter: "LoRA (rank=16)",
    createdAt: new Date("2024-01-14"),
    accuracy: 91.4,
  },
  {
    id: "model-ft-2",
    name: "ModelForge-Gemma-2B-FAQ",
    description:
      "Fine-tuned on FAQ dataset. Currently training — results available when complete.",
    type: "finetuned",
    status: "training",
    parameters: "2B + LoRA",
    baseModel: "Gemma 2B",
    adapter: "LoRA (rank=8)",
    createdAt: new Date("2024-01-15"),
  },
];

// ─── Quick Action Prompts (for welcome screen) ────────────────────────────────
export const quickPrompts = [
  {
    icon: "📁",
    title: "Upload a dataset",
    description: "Prepare your JSONL or CSV training data",
    prompt: "How do I format my dataset for fine-tuning?",
  },
  {
    icon: "⚡",
    title: "Start fine-tuning",
    description: "Train Gemma 2B on your custom data",
    prompt: "Walk me through starting a fine-tuning job",
  },
  {
    icon: "🧪",
    title: "Test my model",
    description: "Chat with your fine-tuned model",
    prompt: "How do I test my fine-tuned model's performance?",
  },
  {
    icon: "📊",
    title: "Check training progress",
    description: "Monitor loss curves and job status",
    prompt: "Show me how to read training metrics and loss curves",
  },
];
