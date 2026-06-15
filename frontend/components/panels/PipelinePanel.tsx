import {
  CheckCircle2,
  Database,
  Brain,
  BarChart3,
  PackageCheck,
  Rocket,
  MessageSquare,
  FileSearch,
} from "lucide-react";

const pipelineSteps = [
  {
    title: "Dataset Upload",
    description: "User uploads CSV/JSONL training data.",
    icon: Database,
    status: "Completed",
    detail: "MATH_1000.csv",
  },
  {
    title: "Fine-Tuning",
    description: "Qwen2.5-1.5B fine-tuned using LoRA/QLoRA.",
    icon: Brain,
    status: "Completed",
    detail: "50 steps · LoRA · Unsloth",
  },
  {
    title: "Evaluation",
    description: "Model tested on unseen math questions.",
    icon: BarChart3,
    status: "Completed",
    detail: "Final loss ~1.16 · Sample accuracy ~80%",
  },
  {
    title: "Quantization",
    description: "Fine-tuned model exported to GGUF format.",
    icon: PackageCheck,
    status: "Completed",
    detail: "Q4_K_M · Local friendly",
  },
  {
    title: "Deployment",
    description: "Quantized model deployed locally using Ollama.",
    icon: Rocket,
    status: "Completed",
    detail: "modelforge-qwen-math",
  },
  {
    title: "Inference",
    description: "FastAPI /chat sends user prompts to Ollama.",
    icon: MessageSquare,
    status: "Completed",
    detail: "Frontend → FastAPI → Ollama",
  },
  {
    title: "RAG Pipeline",
    description: "PDF upload, chunking, embeddings and FAISS retrieval.",
    icon: FileSearch,
    status: "Completed",
    detail: "PyPDFLoader · all-MiniLM-L6-v2 · FAISS",
  },
];

export default function PipelinePanel() {
  return (
    <div className="relative flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-[0.3em] text-sky-400 font-semibold mb-2">
            ModelForge Pipeline
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">
            No-Code LLM Lifecycle Pipeline
          </h1>
          <p className="text-sm text-[#8b91a3] max-w-3xl leading-relaxed">
            ModelForge automates the complete LLM customization workflow:
            dataset upload, fine-tuning, evaluation, quantization, local
            deployment, inference, and RAG-based document question answering.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5">
            <div className="text-xs text-[#6b7080] mb-1">Base Model</div>
            <div className="text-lg font-semibold text-white">
              Qwen2.5-1.5B-Instruct
            </div>
          </div>

          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5">
            <div className="text-xs text-[#6b7080] mb-1">Fine-Tuned Model</div>
            <div className="text-lg font-semibold text-white">
              ModelForge-Qwen-Math-LoRA
            </div>
          </div>

          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5">
            <div className="text-xs text-[#6b7080] mb-1">Local Runtime</div>
            <div className="text-lg font-semibold text-white">
              Ollama + GGUF Q4_K_M
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white/[0.035] border border-white/[0.08] p-5">
          <div className="space-y-4">
            {pipelineSteps.map((step, index) => {
              const Icon = step.icon;

              return (
                <div key={step.title} className="relative">
                  <div className="flex items-start gap-4 rounded-xl bg-[#111318] border border-white/[0.06] p-4">
                    <div className="w-11 h-11 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                      <Icon size={20} className="text-sky-400" />
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-white">
                          {index + 1}. {step.title}
                        </h3>
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 size={11} />
                          {step.status}
                        </span>
                      </div>

                      <p className="text-xs text-[#8b91a3] mb-2">
                        {step.description}
                      </p>

                      <div className="text-[11px] text-[#555a6e]">
                        {step.detail}
                      </div>
                    </div>
                  </div>

                  {index !== pipelineSteps.length - 1 && (
                    <div className="ml-[22px] h-4 w-px bg-white/[0.1]" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 rounded-2xl bg-sky-500/10 border border-sky-500/20 p-5">
          <h2 className="text-sm font-semibold text-sky-300 mb-2">
            Product Value
          </h2>
          <p className="text-sm text-[#c8cdd8] leading-relaxed">
            ModelForge is not just a chatbot. It is a no-code platform that
            turns manual AI engineering steps into a guided pipeline where users
            can fine-tune, retrieve knowledge through RAG, quantize, deploy, and
            test local LLMs from one interface.
          </p>
        </div>
      </div>
    </div>
  );
}