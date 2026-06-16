from fastapi import FastAPI, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import shutil
import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from database import engine, SessionLocal
from model import Base, Dataset, TrainingJob, FineTunedModel
import requests
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from dataset_generator import generate_dataset_from_pdf
import time
import requests
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

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

RAG_UPLOAD_DIR = "rag_uploads"
VECTOR_DIR = "vector_store"

os.makedirs(RAG_UPLOAD_DIR, exist_ok=True)
os.makedirs(VECTOR_DIR, exist_ok=True)

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

@app.get("/")
def home():
    return {"message": "ModelForge Lite Backend Running"}


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
    ext = file.filename.split(".")[-1].lower()

    if ext not in ["csv", "jsonl"]:
        return {
            "status": "error",
            "message": "Only CSV and JSONL files are supported."
        }

    dataset_id = f"ds-{uuid.uuid4().hex[:8]}"
    file_path = os.path.join(UPLOAD_DIR, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    new_dataset = Dataset(
        id=dataset_id,
        name=file.filename,
        format=ext,
        path=file_path,
        rows_count=0,
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
    records = db.query(Dataset).all()

    return [
        {
            "id": d.id,
            "name": d.name,
            "format": d.format,
            "path": d.path,
            "rows_count": d.rows_count,
            "uploadedAt": d.uploaded_at.isoformat(),
            "status": "ready",
        }
        for d in records
    ]

@app.post("/start-training")
def start_training(
    config: TrainingConfig,
    db: Session = Depends(get_db)
):
    job_id = f"job-{uuid.uuid4().hex[:8]}"

    new_job = TrainingJob(
        id=job_id,
        dataset_id=config.datasetId,
        base_model=config.baseModel,
        status="running",
        training_steps=config.trainingSteps,
        learning_rate=config.learningRate,
        loss_history="1.9,1.6,1.3,1.1",
        accuracy=0.0,
    )

    db.add(new_job)
    db.commit()
    db.refresh(new_job)

    job = {
        "id": new_job.id,
        "name": config.jobName,
        "baseModel": new_job.base_model,
        "datasetId": new_job.dataset_id,
        "datasetName": "Uploaded Dataset",
        "status": new_job.status,
        "progress": 25,
        "currentStep": 8,
        "totalSteps": new_job.training_steps,
        "learningRate": new_job.learning_rate,
        "startedAt": new_job.created_at.isoformat(),
        "lossHistory": [1.9, 1.6, 1.3, 1.1],
    }
    threading.Thread(
        target=run_training,
        args=(config.datasetId,),
        daemon=True
    ).start()
    return {
        "status": "success",
        "message": "Training job started successfully",
        "data": job,
    }

@app.get("/training/jobs")
def get_training_jobs(db: Session = Depends(get_db)):
    records = db.query(TrainingJob).all()

    return [
        {
            "id": j.id,
            "name": "Gemma Fine-Tuning Job",
            "baseModel": j.base_model,
            "datasetId": j.dataset_id,
            "datasetName": "Uploaded Dataset",
            "status": j.status,
            "progress": 25 if j.status == "running" else 100,
            "currentStep": 8,
            "totalSteps": j.training_steps,
            "learningRate": j.learning_rate,
            "startedAt": j.created_at.isoformat(),
            "lossHistory": [float(x) for x in j.loss_history.split(",") if x],
        }
        for j in records
    ]

@app.get("/training/jobs/{job_id}")
def get_training_job(job_id: str, db: Session = Depends(get_db)):
    j = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()

    if not j:
        return {"status": "error", "message": "Job not found"}

    return {
        "id": j.id,
        "name": "Gemma Fine-Tuning Job",
        "baseModel": j.base_model,
        "datasetId": j.dataset_id,
        "datasetName": "Uploaded Dataset",
        "status": j.status,
        "progress": 25 if j.status == "running" else 100,
        "currentStep": 8,
        "totalSteps": j.training_steps,
        "learningRate": j.learning_rate,
        "startedAt": j.created_at.isoformat(),
        "lossHistory": [float(x) for x in j.loss_history.split(",") if x],
    }

@app.get("/training-status")
def training_status():
    return {
        "status": "completed",
        "loss": [1.9, 1.6, 1.3, 1.1],
    }

@app.get("/models")
def get_models():
    return [
        {
            "id": "base-gemma",
            "name": "Base Qwen2.5-1.5B-Instruct 2B",
            "type": "base",
            "status": "available",
        },
        {
            "id": "finetuned-model",
            "name": "ModelForge-Qwen-Math-LoRA",
            "type": "adapter",
            "status": "placeholder",
        },
    ]

@app.post("/rag/upload")
async def upload_rag_document(file: UploadFile = File(...)):
    try:
        file_path = os.path.join(RAG_UPLOAD_DIR, file.filename)

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
            "filename": file.filename,
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
        ext = file.filename.split(".")[-1].lower()

        if ext != "pdf":
            return {
                "status": "error",
                "message": "Only PDF files are supported for auto dataset generation."
            }

        file_path = os.path.join(RAG_UPLOAD_DIR, file.filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        result = generate_dataset_from_pdf(file_path)

        return {
            "status": "success",
            "message": "Training dataset generated successfully from PDF.",
            "filename": file.filename,
            "dataset_id": result["dataset_id"],
            "path": result["path"],
            "rows": result["rows"]
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }