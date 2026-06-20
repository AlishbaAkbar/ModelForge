from fastapi import FastAPI, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import shutil
import uuid
import csv
import json
import sys
from datetime import datetime
from sqlalchemy.orm import Session
from database import engine, SessionLocal
from model import Base, Dataset, TrainingJob, FineTunedModel
import requests
import time
from train_lora import run_training
import threading

app = FastAPI(title="ModelForge Lite Backend")
Base.metadata.create_all(bind=engine)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

RAG_UPLOAD_DIR = os.path.join(BASE_DIR, "rag_uploads")
VECTOR_DIR = os.path.join(BASE_DIR, "vector_store")
GENERATED_DATASET_DIR = os.path.join(BASE_DIR, "generated_datasets")
ARTIFACT_DIR = os.path.join(BASE_DIR, "artifacts")

os.makedirs(RAG_UPLOAD_DIR, exist_ok=True)
os.makedirs(VECTOR_DIR, exist_ok=True)
os.makedirs(GENERATED_DATASET_DIR, exist_ok=True)
os.makedirs(ARTIFACT_DIR, exist_ok=True)


def safe_filename(filename: str) -> str:
    name = os.path.basename(filename or "")
    safe = "".join(c if c.isalnum() or c in "._- " else "_" for c in name).strip()
    return safe or f"upload-{uuid.uuid4().hex[:8]}"


def count_dataset_rows(path: str, file_format: str) -> int:
    if file_format == "jsonl":
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return sum(1 for line in f if line.strip())

    if file_format == "csv":
        with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
            reader = csv.reader(f)
            rows = sum(1 for _ in reader)
            return max(0, rows - 1)

    return 0


def parse_loss_history(loss_history: str):
    return [float(x) for x in (loss_history or "").split(",") if x]


def read_json_file(path: str):
    if not os.path.exists(path):
        return None

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def read_jsonl_file(path: str):
    if not os.path.exists(path):
        return []

    rows = []
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def serialize_training_job(job: TrainingJob, dataset: Dataset | None = None):
    losses = parse_loss_history(job.loss_history)
    recorded_steps = max(1, min(job.training_steps or 1, 20))

    if job.status == "completed":
        progress = 100
        current_step = job.training_steps
    elif job.status == "running":
        progress = min(99, max(1, round((len(losses) / recorded_steps) * 100)))
        current_step = min(job.training_steps, round((len(losses) / recorded_steps) * job.training_steps))
    else:
        progress = 0
        current_step = 0

    return {
        "id": job.id,
        "name": f"{job.base_model} Fine-Tuning Job",
        "baseModel": job.base_model,
        "datasetId": job.dataset_id,
        "datasetName": dataset.name if dataset else "Uploaded Dataset",
        "status": job.status,
        "progress": progress,
        "currentStep": current_step,
        "totalSteps": job.training_steps,
        "learningRate": job.learning_rate,
        "startedAt": job.created_at.isoformat(),
        "lossHistory": losses,
    }

class ChatRequest(BaseModel):
    message: str
    model: str = ""
    session_id: str = ""
class RAGQuery(BaseModel):
    question: str
    top_k: int = 2


@app.post("/rag/query")
def rag_query(req: RAGQuery):
    start_time = time.time()

    try:
        from langchain_community.embeddings import HuggingFaceEmbeddings
        from langchain_community.vectorstores import FAISS

        embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2"
        )

        vectorstore = FAISS.load_local(
            VECTOR_DIR,
            embeddings,
            allow_dangerous_deserialization=True
        )

        docs_with_scores = vectorstore.similarity_search_with_score(
            req.question,
            k=req.top_k
        )

        retrieved_chunks = []
        for i, (doc, score) in enumerate(docs_with_scores):
            retrieved_chunks.append({
                "rank": i + 1,
                "score": float(score),
                "content": doc.page_content[:800],
                "metadata": doc.metadata
            })

        context = "\n\n".join(
            [doc.page_content[:500] for doc, score in docs_with_scores]
        )
        prompt = f"""
You are ModelForge RAG Assistant.

Answer the user's question using ONLY the uploaded document context below.
If the answer is not present in the context, say:
"I could not find this information in the uploaded document."

Keep the answer clear and concise.

DOCUMENT CONTEXT:
{context}

USER QUESTION:
{req.question}

FINAL ANSWER:
"""

        ollama_payload = {
            "model": "modelforge-qwen-math",
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_ctx": 1024
            }
        }

        ollama_response = requests.post(
            "http://localhost:11434/api/generate",
            json=ollama_payload,
            timeout=120
        )

        ollama_data = ollama_response.json()
        answer = ollama_data.get("response", "No answer generated.")

        return {
            "status": "success",
            "question": req.question,
            "answer": answer,
            "retrieved_context": context[:1500],
            "sources": retrieved_chunks,
            "metrics": {
                "top_k": req.top_k,
                "retrieved_chunks_count": len(docs_with_scores),
                "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
                "vector_db": "FAISS",
                "llm": "modelforge-qwen-math via Ollama",
                "response_time_ms": round((time.time() - start_time) * 1000, 2)
            }
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
class TrainingConfig(BaseModel):
    jobName: str = "Gemma Fine-Tuning Job"
    baseModel: str = "gemma-2b"
    datasetId: str
    trainingSteps: int = 30
    learningRate: float = 0.00005
    hfModel: str | None = None
    maxExamples: int | None = None
    maxSeqLength: int | None = None
    batchSize: int | None = None
    gradAccum: int | None = None
    loraR: int | None = None
    loraAlpha: int | None = None

@app.get("/")
def home():
    return {"message": "ModelForge Lite Backend Running"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "modelforge-backend",
        "timestamp": datetime.utcnow().isoformat(),
        "python": sys.executable,
        "database": engine.url.database,
        "baseDir": BASE_DIR,
    }


API_URL = "https://api-inference.huggingface.co/models/google/gemma-2b-it"
HF_TOKEN = os.getenv("HF_TOKEN", "")
headers = {
    "Authorization": f"Bearer {HF_TOKEN}"
}
@app.post("/chat")
def chat(req: ChatRequest):
    try:
        if req.model == "finetuned-model":
            model_name = "modelforge-qwen-math"
        else:
            model_name = "qwen2.5:1.5b"

        payload = {
            "model": model_name,
            "prompt": req.message,
            "stream": False
        }

        response = requests.post(
            "http://localhost:11434/api/generate",
            json=payload,
            timeout=120
        )

        data = response.json()

        return {
            "response": data.get("response", "No response generated."),
            "model_used": model_name
        }

    except Exception as e:
        return {
            "response": f"Error: {str(e)}"
        }
# @app.post("/chat")
# def chat(req: ChatRequest):
#     if req.model == "finetuned-model":
#         return {
#             "response": (
#                 "Fine-tuned model selected: ModelForge-Qwen-Math-LoRA.\n\n"
#                 "This model has been trained on the MATH dataset using LoRA and uploaded to Hugging Face:\n"
#                 "https://huggingface.co/alishhhhhba/ModelForge-Qwen-Math-LoRA\n\n"
#                 f"Your prompt was: {req.message}"
#             )
#         }

#     return {
#         "response": (
#             "Base model selected: Qwen2.5-1.5B-Instruct.\n\n"
#             f"Your prompt was: {req.message}"
#         )
#     }

@app.post("/upload-dataset")
async def upload_dataset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    filename = safe_filename(file.filename)
    ext = filename.split(".")[-1].lower()

    if ext not in ["csv", "jsonl"]:
        return {
            "status": "error",
            "message": "Only CSV and JSONL files are supported."
        }

    dataset_id = f"ds-{uuid.uuid4().hex[:8]}"
    file_path = os.path.join(UPLOAD_DIR, f"{dataset_id}-{filename}")

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        rows_count = count_dataset_rows(file_path, ext)
    except Exception as e:
        return {
            "status": "error",
            "message": f"Dataset could not be parsed: {str(e)}"
        }

    new_dataset = Dataset(
        id=dataset_id,
        name=filename,
        format=ext,
        path=file_path,
        rows_count=rows_count,
    )

    db.add(new_dataset)
    db.commit()
    db.refresh(new_dataset)

    return {
        "status": "success",
        "message": "Dataset uploaded successfully",
        "filename": file.filename,
        "dataset": {
            "id": new_dataset.id,
            "name": new_dataset.name,
            "format": new_dataset.format,
            "path": new_dataset.path,
            "rows_count": new_dataset.rows_count,
            "uploadedAt": new_dataset.uploaded_at.isoformat(),
        },
    }

@app.get("/datasets")
def get_datasets(db: Session = Depends(get_db)):
    records = db.query(Dataset).order_by(Dataset.uploaded_at.desc()).all()

    return [
        {
            "id": d.id,
            "name": d.name,
            "format": d.format,
            "path": d.path,
            "rows_count": d.rows_count,
            "size": f"{round(os.path.getsize(d.path) / 1024)} KB" if d.path and os.path.exists(d.path) else "N/A",
            "uploadedAt": d.uploaded_at.isoformat(),
            "status": "ready",
        }
        for d in records
    ]


@app.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str, db: Session = Depends(get_db)):
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()

    if not dataset:
        return {"status": "error", "message": "Dataset not found"}

    if db.query(TrainingJob).filter(TrainingJob.dataset_id == dataset_id).first():
        return {
            "status": "error",
            "message": "Dataset is linked to training jobs and cannot be deleted."
        }

    if dataset.path and os.path.exists(dataset.path):
        os.remove(dataset.path)

    db.delete(dataset)
    db.commit()

    return {"status": "success", "message": "Dataset deleted"}


@app.post("/start-training")
def start_training(
    config: TrainingConfig,
    db: Session = Depends(get_db)
):
    dataset = db.query(Dataset).filter(Dataset.id == config.datasetId).first()

    if not dataset:
        generated_path = os.path.join(GENERATED_DATASET_DIR, f"{config.datasetId}.jsonl")
        if os.path.exists(generated_path):
            dataset = Dataset(
                id=config.datasetId,
                name=f"{config.datasetId}.jsonl",
                format="jsonl",
                path=generated_path,
                rows_count=count_dataset_rows(generated_path, "jsonl"),
            )
            db.add(dataset)
            db.commit()
            db.refresh(dataset)
        else:
            return {"status": "error", "message": "Dataset not found"}

    job_id = f"job-{uuid.uuid4().hex[:8]}"

    new_job = TrainingJob(
        id=job_id,
        dataset_id=config.datasetId,
        base_model=config.baseModel,
        status="pending",
        training_steps=config.trainingSteps,
        learning_rate=config.learningRate,
        loss_history="",
        accuracy=0.0,
    )

    db.add(new_job)
    db.commit()
    db.refresh(new_job)

    job = serialize_training_job(new_job, dataset)
    threading.Thread(
        target=run_training,
        args=(
            new_job.id,
            config.datasetId,
            dataset.path,
            config.trainingSteps,
            config.learningRate,
            {
                "hf_model": config.hfModel,
                "max_examples": config.maxExamples,
                "max_seq_length": config.maxSeqLength,
                "batch_size": config.batchSize,
                "grad_accum": config.gradAccum,
                "lora_r": config.loraR,
                "lora_alpha": config.loraAlpha,
            },
        ),
        daemon=True
    ).start()
    return {
        "status": "success",
        "message": "Training job started successfully",
        "data": job,
    }

@app.get("/training/jobs")
def get_training_jobs(db: Session = Depends(get_db)):
    records = db.query(TrainingJob).order_by(TrainingJob.created_at.desc()).all()

    return [serialize_training_job(j, db.query(Dataset).filter(Dataset.id == j.dataset_id).first()) for j in records]

@app.get("/training/jobs/{job_id}")
def get_training_job(job_id: str, db: Session = Depends(get_db)):
    j = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()

    if not j:
        return {"status": "error", "message": "Job not found"}

    dataset = db.query(Dataset).filter(Dataset.id == j.dataset_id).first()
    return serialize_training_job(j, dataset)


@app.get("/training/jobs/{job_id}/artifacts")
def get_training_artifacts(job_id: str, db: Session = Depends(get_db)):
    job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()

    if not job:
        return {"status": "error", "message": "Job not found"}

    run_dir = os.path.join(ARTIFACT_DIR, "training_runs", job_id)
    manifest_path = os.path.join(run_dir, "adapter_manifest.json")
    metrics_path = os.path.join(run_dir, "metrics.jsonl")
    adapter_dir = os.path.join(run_dir, "adapter")

    return {
        "status": "success",
        "job": serialize_training_job(
            job,
            db.query(Dataset).filter(Dataset.id == job.dataset_id).first(),
        ),
        "paths": {
            "runDir": run_dir,
            "adapterDir": adapter_dir if os.path.exists(adapter_dir) else None,
            "manifest": manifest_path if os.path.exists(manifest_path) else None,
            "metrics": metrics_path if os.path.exists(metrics_path) else None,
        },
        "manifest": read_json_file(manifest_path),
        "metrics": read_jsonl_file(metrics_path),
    }

@app.get("/training-status")
def training_status(db: Session = Depends(get_db)):
    latest = db.query(TrainingJob).order_by(TrainingJob.created_at.desc()).first()

    if not latest:
        return {"status": "idle", "loss": []}

    return {
        "status": latest.status,
        "loss": parse_loss_history(latest.loss_history),
    }

@app.get("/models")
def get_models(db: Session = Depends(get_db)):
    models = [
        {
            "id": "base-gemma",
            "name": "Base Qwen2.5-1.5B-Instruct 2B",
            "type": "base",
            "status": "available",
            "description": "Local base model served through Ollama.",
            "parameters": "1.5B",
        },
    ]

    for model in db.query(FineTunedModel).order_by(FineTunedModel.created_at.desc()).all():
        models.append({
            "id": model.id,
            "name": model.name,
            "type": "adapter",
            "status": "available",
            "description": "Fine-tuned adapter artifact produced by a ModelForge training job.",
            "parameters": "LoRA adapter",
            "baseModel": model.base_model,
            "adapter": model.adapter_path,
            "accuracy": model.accuracy,
            "createdAt": model.created_at.isoformat(),
        })

    return models


@app.get("/pipeline/status")
def pipeline_status(db: Session = Depends(get_db)):
    datasets = db.query(Dataset).order_by(Dataset.uploaded_at.desc()).all()
    latest_dataset = datasets[0] if datasets else None
    latest_job = db.query(TrainingJob).order_by(TrainingJob.created_at.desc()).first()
    models = db.query(FineTunedModel).order_by(FineTunedModel.created_at.desc()).all()
    latest_model = models[0] if models else None
    vector_index_exists = (
        os.path.exists(os.path.join(VECTOR_DIR, "index.faiss"))
        and os.path.exists(os.path.join(VECTOR_DIR, "index.pkl"))
    )

    completed_training = latest_job is not None and latest_job.status == "completed"
    has_adapter = latest_model is not None

    return {
        "status": "success",
        "summary": {
            "datasets": len(datasets),
            "trainingJobs": db.query(TrainingJob).count(),
            "models": len(models),
            "ragIndexed": vector_index_exists,
        },
        "latestDataset": {
            "id": latest_dataset.id,
            "name": latest_dataset.name,
            "format": latest_dataset.format,
            "rows": latest_dataset.rows_count,
            "size": f"{round(os.path.getsize(latest_dataset.path) / 1024)} KB" if latest_dataset.path and os.path.exists(latest_dataset.path) else "N/A",
            "uploadedAt": latest_dataset.uploaded_at.isoformat(),
        } if latest_dataset else None,
        "latestTrainingJob": serialize_training_job(
            latest_job,
            db.query(Dataset).filter(Dataset.id == latest_job.dataset_id).first() if latest_job else None,
        ) if latest_job else None,
        "latestModel": {
            "id": latest_model.id,
            "name": latest_model.name,
            "baseModel": latest_model.base_model,
            "adapterPath": latest_model.adapter_path,
            "createdAt": latest_model.created_at.isoformat(),
        } if latest_model else None,
        "steps": {
            "dataset": "completed" if latest_dataset else "pending",
            "training": latest_job.status if latest_job else "pending",
            "evaluation": "ready" if completed_training else "blocked",
            "modelRegistry": "completed" if has_adapter else "blocked",
            "deployment": "ready" if has_adapter else "blocked",
            "inference": "ready" if has_adapter else "base-only",
            "rag": "completed" if vector_index_exists else "pending",
        },
    }

@app.post("/rag/upload")
async def upload_rag_document(file: UploadFile = File(...)):
    try:
        from langchain_community.document_loaders import PyPDFLoader
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        from langchain_community.embeddings import HuggingFaceEmbeddings
        from langchain_community.vectorstores import FAISS

        filename = safe_filename(file.filename)
        file_path = os.path.join(RAG_UPLOAD_DIR, f"{uuid.uuid4().hex[:8]}-{filename}")

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        loader = PyPDFLoader(file_path)
        documents = loader.load()

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=100
        )

        chunks = splitter.split_documents(documents)

        embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2"
        )

        vectorstore = FAISS.from_documents(
            chunks,
            embeddings
        )

        vectorstore.save_local(VECTOR_DIR)

        return {
            "status": "success",
            "filename": filename,
            "pages": len(documents),
            "chunks": len(chunks),
            "message": "Document indexed successfully"
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
@app.post("/generate-training-dataset")
async def generate_training_dataset(file: UploadFile = File(...)):
    try:
        from dataset_generator import generate_dataset_from_pdf

        filename = safe_filename(file.filename)
        ext = filename.split(".")[-1].lower()

        if ext != "pdf":
            return {
                "status": "error",
                "message": "Only PDF files are supported for auto dataset generation."
            }

        file_path = os.path.join(RAG_UPLOAD_DIR, f"{uuid.uuid4().hex[:8]}-{filename}")

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        result = generate_dataset_from_pdf(file_path)

        generated_dataset = Dataset(
            id=result["dataset_id"],
            name=f"{result['dataset_id']}.jsonl",
            format="jsonl",
            path=result["path"],
            rows_count=result["rows"],
        )
        db = SessionLocal()
        db.add(generated_dataset)
        db.commit()
        db.close()

        return {
            "status": "success",
            "message": "Training dataset generated successfully from PDF.",
            "filename": filename,
            "dataset_id": result["dataset_id"],
            "path": result["path"],
            "rows": result["rows"]
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
