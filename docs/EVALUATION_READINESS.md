# ModelForge Evaluation Readiness

This document maps ModelForge against the Generative AI Engineer project checklist and identifies what can be demonstrated tomorrow.

## Problem Framing

One-sentence problem statement:

ModelForge helps non-ML users customize open-source LLMs by preparing datasets, fine-tuning adapters, managing RAG documents, evaluating outputs, and deploying selected models from a single no-code dashboard.

Target users:

- Small companies that need internal document Q&A.
- Students/researchers experimenting with LoRA fine-tuning.
- Teams that need local/private LLM workflows without writing training scripts.

Competitor/reference tools:

- Hugging Face AutoTrain: fine-tuning automation.
- Unsloth: efficient QLoRA training.
- LlamaIndex/LangChain: RAG pipelines.
- Ollama: local model serving.

## Model Selection

Chosen local runtime:

- `qwen2.5:1.5b` through Ollama.

Chosen remote fine-tuning path:

- `unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit` through Kaggle/remote GPU package.

Justification:

- Qwen is small enough for local demonstration.
- Qwen supports instruction-following and adapter-based customization.
- Unsloth QLoRA is GPU-efficient and realistic for fine-tuning.
- Ollama is practical for local serving in an FYP environment.

## Prompt Engineering Evidence

Prompt files are stored in `prompts/`:

- `rag_answer_v1.txt`
- `model_chat_system_v1.txt`
- `dataset_generation_v1.txt`
- `evaluation_judge_v1.txt`

Prompt techniques represented:

- System prompt design
- Negative prompting
- Structured output prompting
- Grounded RAG prompting
- Evaluation-as-judge prompting

## RAG Implementation

Implemented:

- PDF upload and document records.
- Persistent document storage.
- Page-wise text extraction.
- Overlapping chunking.
- Metadata per chunk:
  - document id
  - document name
  - page number
  - chunk id
  - owner
- Persistent chunk index in `backend/vector_store/chunks.jsonl`.
- Top-k retrieval.
- Source citations.
- Retrieved chunk display in frontend.
- RAG metrics:
  - retrieved chunk count
  - retrieval relevance
  - context precision
  - answer quality
  - response time

Presentation explanation:

ModelForge currently uses a stable local persistent chunk index for RAG. This avoids slow embedding rebuilds during demo. The design can be upgraded to FAISS/Chroma/Qdrant embeddings in production.

## Fine-Tuning Implementation

Implemented:

- Dataset upload.
- Dataset validation and row counting.
- Local LoRA smoke-test training.
- Loss history and training artifacts.
- Adapter registry.
- Kaggle/remote QLoRA package generation.
- Qwen adapter import.

Important distinction:

- Local CPU training is only a smoke test.
- Real Qwen fine-tuning requires remote GPU and imported Qwen adapter output.

## Deployment Implementation

Implemented:

- Model registry.
- Adapter artifact validation.
- Deploy-ready vs deploy-blocked classification.
- Ollama Modelfile generation.
- Full adapter bundle copy for deployment.
- Deployment history with clean failure messages.
- Chat dropdown only includes deployed custom models.

Current environment blocker:

Ollama returns `Error: Access is denied.` on Windows during `ollama create` for the imported adapter. The generated deployment bundle is complete, so this is a local Ollama/file-permission issue, not a missing ModelForge artifact issue.

## Evaluation Evidence

Available in the Evaluation dashboard:

- Dataset count.
- Training job count.
- RAG indexed document count.
- Persisted chunk count.
- Training loss status.
- RAG faithfulness/citation evidence.
- Deployment readiness status.

Manual demo test set:

1. Ask RAG: "What are Shinza's main core skills?"
2. Ask RAG: "Show basic router commands."
3. Ask RAG with unrelated query to show fallback behavior.
4. Test model deployment readiness with imported Qwen adapter.
5. Show blocked tiny-gpt2 adapters with explanation.

## Responsible AI and Limitations

Mitigations:

- RAG answer fallback when context is missing.
- Citations shown for retrieved evidence.
- Fine-tuned adapter is not used for chat unless deployed.
- Invalid adapters are blocked from deployment.
- Raw backend errors are cleaned before showing in UI.

Limitations:

- No production auth/user isolation yet.
- No Docker/cloud deployment yet.
- No full benchmark suite such as MMLU/HumanEval.
- No full vector embedding retrieval in stable demo mode.
- No Celery/Redis GPU queue; remote GPU package is prepared instead.

## Rubric Mapping

| Rubric Area | Status | Evidence |
| --- | --- | --- |
| Problem framing | Ready | README and presentation framing |
| Model selection | Ready | Qwen/Ollama/Unsloth justification |
| Prompt engineering | Ready | `prompts/` folder |
| RAG implementation | Ready | PDF upload, chunking, retrieval, citations |
| Evaluation rigor | Partial/Ready for FYP | Evaluation dashboard, RAG metrics, manual test scenarios |
| App quality | Ready | Next.js UI + FastAPI backend |
| Deployment | Partial | Ollama deployment path implemented; local permission issue documented |
| Responsible AI | Ready | Grounding, citations, limitations |
| Fine-tuning bonus | Partial/Ready for demo | Local smoke LoRA + remote QLoRA package + adapter import |

## Five-Minute Demo Flow

1. Open Pipeline dashboard and show lifecycle overview.
2. Open RAG, upload/select PDF, ask a question, show top-k chunks and citations.
3. Open My Models, explain adapter lifecycle and deploy-ready/blocker statuses.
4. Open Evaluation dashboard and show live scorecard.
5. Explain future production work: vector DB, PostgreSQL, Docker/cloud deployment, job queue, benchmark suite.
