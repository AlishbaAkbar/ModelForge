from fastapi import FastAPI, UploadFile, File, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import shutil
import uuid
import csv
import json
import sys
import subprocess
import zipfile
import hashlib
import math
import re
from typing import Dict, Any
from datetime import datetime
from sqlalchemy.orm import Session
from database import engine, SessionLocal
from model import Base, Dataset, TrainingJob, FineTunedModel, Deployment, RAGDocument
import requests
import time
from train_lora import run_training
import threading
from typing import Dict, Any
from fastapi import BackgroundTasks

app = FastAPI(title="ModelForge Lite Backend")
Base.metadata.create_all(bind=engine)


def ensure_sqlite_columns():
    if not str(engine.url).startswith("sqlite"):
        return

    with engine.connect() as connection:
        rows = connection.exec_driver_sql("PRAGMA table_info(rag_documents)").fetchall()
        columns = {row[1] for row in rows}
        if rows and "content_hash" not in columns:
            connection.exec_driver_sql("ALTER TABLE rag_documents ADD COLUMN content_hash VARCHAR DEFAULT ''")
            connection.commit()


ensure_sqlite_columns()


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
RAG_CHUNKS_PATH = os.path.join(VECTOR_DIR, "chunks.jsonl")
RAG_LLM_MODEL = os.getenv("RAG_LLM_MODEL", "qwen2.5:1.5b")
RAG_EMBEDDING_PROVIDER = os.getenv("RAG_EMBEDDING_PROVIDER", "local-hash")
RAG_USE_OLLAMA = os.getenv("RAG_USE_OLLAMA", "false").lower() == "true"
RAG_INDEX_LOCK = threading.Lock()
RAG_JOBS: Dict[str, Dict[str, Any]] = {}
GENERATED_DATASET_DIR = os.path.join(BASE_DIR, "generated_datasets")
ARTIFACT_DIR = os.path.join(BASE_DIR, "artifacts")
COLAB_EXPORT_DIR = os.path.join(BASE_DIR, "colab_exports")
KAGGLE_EXPORT_DIR = os.path.join(BASE_DIR, "kaggle_exports")
KAGGLE_CONFIG_DIR = os.path.join(BASE_DIR, "kaggle_config")
DEPLOYMENT_DIR = os.path.join(ARTIFACT_DIR, "deployments")
IMPORTED_ADAPTER_DIR = os.path.join(ARTIFACT_DIR, "imported_adapters")

os.makedirs(RAG_UPLOAD_DIR, exist_ok=True)
os.makedirs(VECTOR_DIR, exist_ok=True)
os.makedirs(GENERATED_DATASET_DIR, exist_ok=True)
os.makedirs(ARTIFACT_DIR, exist_ok=True)
os.makedirs(COLAB_EXPORT_DIR, exist_ok=True)
os.makedirs(KAGGLE_EXPORT_DIR, exist_ok=True)
os.makedirs(KAGGLE_CONFIG_DIR, exist_ok=True)
os.makedirs(DEPLOYMENT_DIR, exist_ok=True)
os.makedirs(IMPORTED_ADAPTER_DIR, exist_ok=True)


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


def read_json_string(value: str):
    try:
        return json.loads(value)
    except Exception:
        return None


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


def infer_training_job_for_model(model: FineTunedModel, db: Session):
    if not model:
        return None

    suffix = model.id.replace("model-", "", 1)
    candidates = []

    if suffix:
        candidates.append(f"job-{suffix}")

    if model.adapter_path:
        for part in model.adapter_path.replace("\\", "/").split("/"):
            if part.startswith("job-"):
                candidates.append(part)

    for job_id in dict.fromkeys(candidates):
        job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()
        if job:
            return job

    return None


def latest_deployment_for_model(model_id: str, db: Session):
    return (
        db.query(Deployment)
        .filter(Deployment.model_id == model_id)
        .order_by(Deployment.created_at.desc())
        .first()
    )


def latest_deployed_deployment_for_model(model_id: str, db: Session):
    return (
        db.query(Deployment)
        .filter(Deployment.model_id == model_id, Deployment.status == "deployed")
        .order_by(Deployment.created_at.desc())
        .first()
    )


def clean_process_output(value: str):
    if not value:
        return ""

    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value)
    text = text.replace("\r", "\n")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)


def deployment_log_summary(deployment: Deployment):
    if not deployment or not deployment.logs:
        return ""

    parsed = read_json_string(deployment.logs)
    if isinstance(parsed, dict):
        if parsed.get("mode") == "existing_runtime_binding":
            return parsed.get("message", "Existing Ollama runtime bound.")
        output = parsed.get("stderr") or parsed.get("stdout") or deployment.logs
    else:
        output = deployment.logs

    cleaned = clean_process_output(output)
    if not cleaned:
        return ""

    lines = cleaned.splitlines()
    return lines[-1][-500:]


def process_error_message(value: str, fallback: str):
    cleaned = clean_process_output(value)
    if not cleaned:
        return fallback

    lines = cleaned.splitlines()
    for line in reversed(lines):
        if line.lower().startswith("error"):
            return line[-500:]

    return lines[-1][-500:] if lines else fallback


def serialize_deployment(deployment: Deployment):
    return {
        "id": deployment.id,
        "modelId": deployment.model_id,
        "trainingJobId": deployment.training_job_id,
        "runtime": deployment.runtime,
        "runtimeModel": deployment.runtime_model,
        "adapterPath": deployment.adapter_path,
        "modelfilePath": deployment.modelfile_path,
        "status": deployment.status,
        "logs": deployment.logs,
        "summary": deployment_log_summary(deployment),
        "createdAt": deployment.created_at.isoformat(),
        "updatedAt": deployment.updated_at.isoformat(),
    }


def serialize_model_record(model: FineTunedModel, db: Session):
    training_job = infer_training_job_for_model(model, db)
    dataset = db.query(Dataset).filter(Dataset.id == training_job.dataset_id).first() if training_job else None
    latest_deployment = latest_deployment_for_model(model.id, db)
    deployed_deployment = latest_deployed_deployment_for_model(model.id, db)
    is_deployed = deployed_deployment is not None
    runtime_model = deployed_deployment.runtime_model if deployed_deployment else ""
    artifact = adapter_artifact_report(model.adapter_path)
    default_runtime_model = default_ollama_model_name(model, db)

    return {
        "id": model.id,
        "name": model.name,
        "type": "adapter",
        "status": "available",
        "description": "Fine-tuned adapter artifact produced by a ModelForge training job.",
        "parameters": "LoRA adapter",
        "baseModel": model.base_model,
        "adapter": model.adapter_path,
        "adapterPath": model.adapter_path,
        "trainingJobId": training_job.id if training_job else "",
        "datasetId": dataset.id if dataset else "",
        "datasetName": dataset.name if dataset else "",
        "deployed": is_deployed,
        "deploymentId": deployed_deployment.id if deployed_deployment else "",
        "runtime": deployed_deployment.runtime if deployed_deployment else "adapter",
        "runtimeModel": runtime_model,
        "defaultRuntimeModel": default_runtime_model,
        "deployReady": artifact["deployReady"],
        "deployBlocker": "" if is_deployed else artifact["deployBlocker"],
        "artifactStatus": artifact["artifactStatus"],
        "adapterBase": artifact["adapterBase"],
        "resolvedAdapterPath": artifact["resolvedAdapterPath"],
        "lastDeploymentStatus": latest_deployment.status if latest_deployment else "",
        "lastDeploymentMessage": deployment_log_summary(latest_deployment),
        "accuracy": model.accuracy,
        "createdAt": model.created_at.isoformat(),
    }


def slugify_model_name(value: str):
    slug = "".join(c.lower() if c.isalnum() else "-" for c in value)
    return "-".join(part for part in slug.split("-") if part)


def default_ollama_model_name(model: FineTunedModel, db: Session):
    training_job = infer_training_job_for_model(model, db)
    dataset = db.query(Dataset).filter(Dataset.id == training_job.dataset_id).first() if training_job else None
    source = dataset.name.rsplit(".", 1)[0] if dataset and dataset.name else model.id
    return f"modelforge-{slugify_model_name(source)}-{model.id.replace('model-', '')[:8]}"


def write_ollama_modelfile(path: str, base_model: str, adapter_path: str):
    normalized_adapter = adapter_path.replace("\\", "/")
    content = (
        f"FROM {base_model}\n"
        f"ADAPTER {normalized_adapter}\n"
        'PARAMETER temperature 0.2\n'
        'SYSTEM """You are a ModelForge fine-tuned assistant. Use the behavior learned from the selected fine-tuning dataset."""\n'
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def resolve_artifact_path(path: str):
    if not path:
        return ""

    if os.path.isabs(path):
        return path

    backend_relative = os.path.join(BASE_DIR, path)
    if os.path.exists(backend_relative):
        return backend_relative

    return os.path.abspath(path)


def read_adapter_config(adapter_path: str):
    resolved_path = resolve_artifact_path(adapter_path)
    config_path = os.path.join(resolved_path, "adapter_config.json")
    if not os.path.exists(config_path):
        return {}

    return read_json_file(config_path) or {}


def adapter_artifact_report(adapter_path: str, base_runtime_model: str = "qwen2.5:1.5b"):
    resolved_path = resolve_artifact_path(adapter_path)
    config_path = os.path.join(resolved_path, "adapter_config.json")
    safetensors_path = os.path.join(resolved_path, "adapter_model.safetensors")

    if not adapter_path:
        return {
            "deployReady": False,
            "deployBlocker": "No adapter path is registered for this model.",
            "artifactStatus": "missing",
            "adapterBase": "",
            "resolvedAdapterPath": resolved_path,
        }

    if not os.path.exists(resolved_path):
        return {
            "deployReady": False,
            "deployBlocker": "Adapter folder is missing on disk.",
            "artifactStatus": "missing",
            "adapterBase": "",
            "resolvedAdapterPath": resolved_path,
        }

    if not os.path.exists(config_path):
        return {
            "deployReady": False,
            "deployBlocker": "adapter_config.json was not found in the adapter artifact.",
            "artifactStatus": "invalid",
            "adapterBase": "",
            "resolvedAdapterPath": resolved_path,
        }

    if not os.path.exists(safetensors_path):
        return {
            "deployReady": False,
            "deployBlocker": "adapter_model.safetensors was not found in the adapter artifact.",
            "artifactStatus": "invalid",
            "adapterBase": read_adapter_config(resolved_path).get("base_model_name_or_path", ""),
            "resolvedAdapterPath": resolved_path,
        }

    compatibility = validate_ollama_adapter_compatibility(resolved_path, base_runtime_model)
    return {
        "deployReady": compatibility["ok"],
        "deployBlocker": "" if compatibility["ok"] else compatibility["message"],
        "artifactStatus": "ready" if compatibility["ok"] else "blocked",
        "adapterBase": compatibility["adapterBase"],
        "resolvedAdapterPath": resolved_path,
    }


def copy_adapter_artifact(adapter_path: str, deployment_dir: str):
    resolved_path = resolve_artifact_path(adapter_path)
    required = ["adapter_config.json", "adapter_model.safetensors"]
    copied = []

    for name in os.listdir(resolved_path):
        source = os.path.join(resolved_path, name)
        target = os.path.join(deployment_dir, name)
        if os.path.isfile(source):
            shutil.copyfile(source, target)
            copied.append(name)

    missing = [name for name in required if name not in copied]
    if missing:
        raise FileNotFoundError(f"Missing required adapter files: {', '.join(missing)}")

    return copied


def validate_ollama_adapter_compatibility(adapter_path: str, base_runtime_model: str):
    adapter_config = read_adapter_config(adapter_path)
    adapter_base = adapter_config.get("base_model_name_or_path", "")
    normalized_adapter_base = adapter_base.lower()
    normalized_runtime = base_runtime_model.lower()

    if "tiny-gpt2" in normalized_adapter_base:
        return {
            "ok": False,
            "message": (
                "This adapter was trained with sshleifer/tiny-gpt2 for CPU smoke testing, "
                "not Qwen. It cannot be deployed as an Ollama Qwen fine-tuned model. "
                "Run the Kaggle/remote GPU Qwen fine-tuning path and import that Qwen adapter."
            ),
            "adapterBase": adapter_base,
        }

    if adapter_base and "qwen" in normalized_runtime and "qwen" not in normalized_adapter_base:
        return {
            "ok": False,
            "message": f"Adapter base model mismatch. Adapter was trained on '{adapter_base}', but deployment target is '{base_runtime_model}'.",
            "adapterBase": adapter_base,
        }

    return {
        "ok": True,
        "message": "Adapter appears compatible with the selected runtime.",
        "adapterBase": adapter_base,
    }


def find_adapter_dir(root_dir: str):
    for root, _dirs, files in os.walk(root_dir):
        if "adapter_config.json" in files and "adapter_model.safetensors" in files:
            return root
    return ""


def safe_extract_zip(zip_path: str, destination: str):
    with zipfile.ZipFile(zip_path, "r") as archive:
        destination_abs = os.path.abspath(destination)
        for member in archive.infolist():
            target = os.path.abspath(os.path.join(destination, member.filename))
            if not target.startswith(destination_abs):
                raise ValueError("Unsafe zip path detected")
        archive.extractall(destination)


def file_sha256(path: str):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def pick_value(row: dict, *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value:
            return str(value).strip()
    return ""


def format_training_text(row: dict) -> str:
    instruction = pick_value(row, "instruction", "prompt", "question", "input_text", "source")
    input_text = pick_value(row, "input", "context")
    response = pick_value(row, "response", "completion", "answer", "output", "target")

    if not instruction and len(row) >= 2:
        values = [str(v).strip() for v in row.values()]
        instruction = values[0]
        response = values[1]

    if not response:
        return ""

    if input_text:
        return (
            "### Instruction:\n"
            f"{instruction}\n\n"
            "### Input:\n"
            f"{input_text}\n\n"
            "### Response:\n"
            f"{response}"
        )

    return (
        "### Instruction:\n"
        f"{instruction}\n\n"
        "### Response:\n"
        f"{response}"
    )


def read_dataset_rows(path: str):
    ext = path.split(".")[-1].lower()

    if ext == "jsonl":
        return read_jsonl_file(path)

    with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
        return list(csv.DictReader(f))


def write_colab_notebook(path: str, job_id: str, drive_job_dir: str):
    notebook = {
        "cells": [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": [
                    "# ModelForge Remote QLoRA Training\n",
                    "Run this notebook on a Google Colab GPU runtime. Default mode does not require Google Drive: upload `dataset.jsonl` and `config.json` when prompted, train Qwen with Unsloth QLoRA, then download `adapter.zip`."
                ],
            },
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "!pip install -q unsloth transformers datasets trl peft accelerate bitsandbytes\n",
                ],
            },
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "import json, os, shutil\n",
                    f"JOB_ID = '{job_id}'\n",
                    f"DRIVE_JOB_DIR = '{drive_job_dir}'\n",
                    "USE_GOOGLE_DRIVE = False  # Keep False if drive.mount gives credential propagation errors.\n",
                    "\n",
                    "if USE_GOOGLE_DRIVE:\n",
                    "    from google.colab import drive\n",
                    "    drive.mount('/content/drive', force_remount=True)\n",
                    "    JOB_DIR = DRIVE_JOB_DIR\n",
                    "else:\n",
                    "    from google.colab import files\n",
                    "    print('Upload dataset.jsonl and config.json from your ModelForge export folder.')\n",
                    "    files.upload()\n",
                    "    JOB_DIR = f'/content/{JOB_ID}'\n",
                    "    os.makedirs(JOB_DIR, exist_ok=True)\n",
                    "    for name in ['dataset.jsonl', 'config.json']:\n",
                    "        source = f'/content/{name}'\n",
                    "        if not os.path.exists(source):\n",
                    "            raise FileNotFoundError(f'Missing {name}. Upload dataset.jsonl and config.json, then rerun this cell.')\n",
                    "        shutil.copy(source, os.path.join(JOB_DIR, name))\n",
                    "\n",
                    "CONFIG_PATH = os.path.join(JOB_DIR, 'config.json')\n",
                    "DATASET_PATH = os.path.join(JOB_DIR, 'dataset.jsonl')\n",
                    "with open(CONFIG_PATH, 'r', encoding='utf-8') as f:\n",
                    "    cfg = json.load(f)\n",
                    "cfg\n",
                ],
            },
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "from datasets import load_dataset\n",
                    "from unsloth import FastLanguageModel\n",
                    "from trl import SFTTrainer\n",
                    "from transformers import TrainingArguments\n",
                    "\n",
                    "dataset = load_dataset('json', data_files=DATASET_PATH, split='train')\n",
                    "model, tokenizer = FastLanguageModel.from_pretrained(\n",
                    "    model_name=cfg['base_model'],\n",
                    "    max_seq_length=cfg['max_seq_length'],\n",
                    "    dtype=None,\n",
                    "    load_in_4bit=True,\n",
                    ")\n",
                    "model = FastLanguageModel.get_peft_model(\n",
                    "    model,\n",
                    "    r=cfg['lora_r'],\n",
                    "    target_modules=['q_proj','k_proj','v_proj','o_proj','gate_proj','up_proj','down_proj'],\n",
                    "    lora_alpha=cfg['lora_alpha'],\n",
                    "    lora_dropout=0,\n",
                    "    bias='none',\n",
                    "    use_gradient_checkpointing='unsloth',\n",
                    "    random_state=3407,\n",
                    ")\n",
                ],
            },
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "trainer = SFTTrainer(\n",
                    "    model=model,\n",
                    "    tokenizer=tokenizer,\n",
                    "    train_dataset=dataset,\n",
                    "    dataset_text_field='text',\n",
                    "    max_seq_length=cfg['max_seq_length'],\n",
                    "    args=TrainingArguments(\n",
                    "        output_dir=os.path.join(JOB_DIR, 'logs'),\n",
                    "        per_device_train_batch_size=1,\n",
                    "        gradient_accumulation_steps=4,\n",
                    "        max_steps=cfg['training_steps'],\n",
                    "        learning_rate=cfg['learning_rate'],\n",
                    "        fp16=True,\n",
                    "        logging_steps=1,\n",
                    "        report_to='none',\n",
                    "    ),\n",
                    ")\n",
                    "trainer.train()\n",
                ],
            },
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "adapter_dir = os.path.join(JOB_DIR, 'adapter')\n",
                    "os.makedirs(adapter_dir, exist_ok=True)\n",
                    "model.save_pretrained(adapter_dir)\n",
                    "tokenizer.save_pretrained(adapter_dir)\n",
                    "with open(os.path.join(JOB_DIR, 'DONE.json'), 'w', encoding='utf-8') as f:\n",
                    "    json.dump({'status': 'completed', 'job_id': JOB_ID, 'adapter_dir': adapter_dir}, f, indent=2)\n",
                    "if not USE_GOOGLE_DRIVE:\n",
                    "    shutil.make_archive('/content/adapter', 'zip', adapter_dir)\n",
                    "    from google.colab import files\n",
                    "    files.download('/content/adapter.zip')\n",
                    "adapter_dir\n",
                ],
            },
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": [
                    "## Optional GGUF/Ollama step\n",
                    "After adapter training works, import `adapter.zip` back into ModelForge. The next milestone is merge/export to GGUF and generate an Ollama `Modelfile`."
                ],
            },
        ],
        "metadata": {
            "accelerator": "GPU",
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(notebook, f, indent=2)


def write_kaggle_training_script(path: str):
    script = r'''
import json
import os
import shutil

from datasets import load_dataset
from transformers import TrainingArguments
from trl import SFTTrainer
from unsloth import FastLanguageModel


INPUT_ROOT = "/kaggle/input"
WORKING_DIR = "/kaggle/working"

dataset_path = None
config_path = None

for root, _dirs, files in os.walk(INPUT_ROOT):
    if "dataset.jsonl" in files and "config.json" in files:
        dataset_path = os.path.join(root, "dataset.jsonl")
        config_path = os.path.join(root, "config.json")
        break

if not dataset_path or not config_path:
    raise FileNotFoundError("Could not find dataset.jsonl and config.json under /kaggle/input")

with open(config_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

dataset = load_dataset("json", data_files=dataset_path, split="train")

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=cfg["base_model"],
    max_seq_length=cfg["max_seq_length"],
    dtype=None,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=cfg["lora_r"],
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha=cfg["lora_alpha"],
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=cfg["max_seq_length"],
    args=TrainingArguments(
        output_dir=os.path.join(WORKING_DIR, "logs"),
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        max_steps=cfg["training_steps"],
        learning_rate=cfg["learning_rate"],
        fp16=True,
        logging_steps=1,
        save_strategy="no",
        report_to="none",
    ),
)

trainer.train()

adapter_dir = os.path.join(WORKING_DIR, "adapter")
os.makedirs(adapter_dir, exist_ok=True)
model.save_pretrained(adapter_dir)
tokenizer.save_pretrained(adapter_dir)

done = {
    "status": "completed",
    "job_id": cfg["job_id"],
    "base_model": cfg["base_model"],
    "examples_exported": cfg["examples_exported"],
    "adapter_dir": adapter_dir,
}

with open(os.path.join(WORKING_DIR, "DONE.json"), "w", encoding="utf-8") as f:
    json.dump(done, f, indent=2)

shutil.make_archive(os.path.join(WORKING_DIR, "adapter"), "zip", adapter_dir)
print(json.dumps(done, indent=2))
'''

    with open(path, "w", encoding="utf-8") as f:
        f.write(script.strip() + "\n")


def write_kaggle_notebook(path: str):
    notebook = {
        "cells": [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": [
                    "# ModelForge Kaggle GPU QLoRA Training\n",
                    "This notebook runs from a ModelForge-created Kaggle Dataset and saves `adapter.zip` as Kaggle output."
                ],
            },
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "!pip install -q unsloth transformers datasets trl peft accelerate bitsandbytes\n",
                    "%run kaggle_train.py\n",
                ],
            },
        ],
        "metadata": {
            "accelerator": "GPU",
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(notebook, f, indent=2)


def read_kaggle_state(job_id: str):
    state_path = os.path.join(KAGGLE_EXPORT_DIR, job_id, "kaggle_state.json")
    return read_json_file(state_path) or {
        "status": "prepared",
        "jobId": job_id,
        "message": "Kaggle package is prepared but not submitted.",
    }


def write_kaggle_state(job_id: str, state: dict):
    state_path = os.path.join(KAGGLE_EXPORT_DIR, job_id, "kaggle_state.json")
    current = read_json_file(state_path) or {}
    current.update(state)
    current["updatedAt"] = datetime.utcnow().isoformat()
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current


def ollama_generate(model_name: str, prompt: str, timeout: int = 120):
    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": model_name,
            "prompt": prompt,
            "stream": False,
        },
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    return data.get("response", "No response generated.")


def ollama_model_exists(model_name: str):
    normalized = (model_name or "").strip().lower()
    if not normalized:
        return False

    try:
        response = requests.get("http://localhost:11434/api/tags", timeout=10)
        response.raise_for_status()
        data = response.json()
        names = {
            str(item.get("name", "")).lower()
            for item in data.get("models", [])
            if item.get("name")
        }
        return normalized in names or f"{normalized}:latest" in names
    except Exception:
        return False


def resolve_model_runtime(model_id: str, db: Session):
    if model_id in ["base-gemma", "qwen2.5:1.5b", "base-qwen"]:
        return {
            "status": "ready",
            "modelId": model_id,
            "runtime": "ollama",
            "runtimeModel": "qwen2.5:1.5b",
            "message": "Base Ollama model selected.",
        }

    if model_id == "finetuned-model":
        return {
            "status": "ready",
            "modelId": model_id,
            "runtime": "ollama",
            "runtimeModel": "modelforge-qwen-math",
            "message": "Legacy Qwen Math fine-tuned Ollama model selected.",
        }

    model = db.query(FineTunedModel).filter(FineTunedModel.id == model_id).first()
    if not model:
        return {
            "status": "error",
            "message": "Model not found.",
        }

    deployment = latest_deployed_deployment_for_model(model.id, db)

    if deployment:
        return {
            "status": "ready",
            "modelId": model.id,
            "runtime": "ollama",
            "runtimeModel": deployment.runtime_model,
            "adapterPath": model.adapter_path,
            "message": "Deployed Ollama model selected.",
        }

    return {
        "status": "not_deployed",
        "modelId": model.id,
        "runtime": "adapter",
        "adapterPath": model.adapter_path,
        "message": "This adapter is registered but not deployed for inference yet. Deploy/merge it to Ollama before testing.",
    }


def run_command(command: list[str], cwd: str | None = None):
    env = os.environ.copy()
    env["KAGGLE_CONFIG_DIR"] = KAGGLE_CONFIG_DIR

    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )

    return {
        "command": " ".join(command),
        "returncode": completed.returncode,
        "stdout": completed.stdout[-4000:],
        "stderr": completed.stderr[-4000:],
    }


def run_kaggle_job(job_id: str):
    job_dir = os.path.join(KAGGLE_EXPORT_DIR, job_id)
    dataset_dir = os.path.join(job_dir, "dataset")
    kernel_dir = os.path.join(job_dir, "kernel")
    output_dir = os.path.join(job_dir, "output")
    logs = []

    try:
        write_kaggle_state(job_id, {
            "status": "submitting_dataset",
            "message": "Uploading private dataset package to Kaggle.",
        })
        dataset_result = run_command([sys.executable, "-m", "kaggle", "datasets", "create", "-p", dataset_dir, "--dir-mode", "zip"])
        logs.append(dataset_result)
        if dataset_result["returncode"] != 0:
            raise RuntimeError(dataset_result["stderr"] or dataset_result["stdout"] or "Kaggle dataset upload failed.")

        write_kaggle_state(job_id, {
            "status": "submitting_kernel",
            "message": "Submitting GPU Kaggle kernel.",
            "logs": logs,
        })
        kernel_result = run_command([sys.executable, "-m", "kaggle", "kernels", "push", "-p", kernel_dir])
        logs.append(kernel_result)
        if kernel_result["returncode"] != 0:
            raise RuntimeError(kernel_result["stderr"] or kernel_result["stdout"] or "Kaggle kernel submission failed.")

        write_kaggle_state(job_id, {
            "status": "running",
            "message": "Kaggle accepted the kernel. Use refresh to check status, then download outputs when complete.",
            "logs": logs,
        })

    except Exception as e:
        write_kaggle_state(job_id, {
            "status": "failed",
            "message": str(e),
            "logs": logs,
        })

class ChatRequest(BaseModel):
    message: str
    model: str = ""
    session_id: str = ""


class ModelTestRequest(BaseModel):
    prompt: str


class ModelDeployRequest(BaseModel):
    ollamaModel: str = "modelforge-qwen-math"
    baseRuntimeModel: str = "qwen2.5:1.5b"


class ModelRuntimeBindRequest(BaseModel):
    ollamaModel: str = "modelforge-qwen-math"
    baseRuntimeModel: str = "qwen2.5:1.5b"


class RAGQuery(BaseModel):
    question: str
    top_k: int = 2
    document_id: str | None = None


class RAGRebuildRequest(BaseModel):
    document_id: str | None = None


_EMBEDDINGS_CACHE = None


class LocalHashEmbeddings:
    def __init__(self, dimensions: int = 384):
        self.dimensions = dimensions

    def _embed(self, text: str):
        vector = [0.0] * self.dimensions
        tokens = re.findall(r"[a-zA-Z0-9_]+", (text or "").lower())
        for token in tokens:
            digest = hashlib.md5(token.encode("utf-8")).hexdigest()
            index = int(digest[:8], 16) % self.dimensions
            sign = 1.0 if int(digest[8:10], 16) % 2 == 0 else -1.0
            vector[index] += sign

        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]

    def embed_documents(self, texts):
        return [self._embed(text) for text in texts]

    def embed_query(self, text):
        return self._embed(text)

    def __call__(self, text):
        return self.embed_query(text)


def get_embeddings():
    global _EMBEDDINGS_CACHE
    if _EMBEDDINGS_CACHE is None:
        if RAG_EMBEDDING_PROVIDER.lower() == "hf":
            from langchain_community.embeddings import HuggingFaceEmbeddings

            _EMBEDDINGS_CACHE = HuggingFaceEmbeddings(
                model_name="sentence-transformers/all-MiniLM-L6-v2"
            )
        else:
            _EMBEDDINGS_CACHE = LocalHashEmbeddings()
    return _EMBEDDINGS_CACHE


def serialize_rag_document(doc: RAGDocument):
    return {
        "id": doc.id,
        "filename": doc.filename,
        "owner": doc.owner,
        "path": doc.path,
        "chunkCount": doc.chunk_count,
        "embeddingStatus": doc.embedding_status,
        "error": doc.error,
        "uploadedAt": doc.uploaded_at.isoformat(),
        "indexedAt": doc.indexed_at.isoformat() if doc.indexed_at else None,
    }


def clear_vector_store():
    for name in ["index.faiss", "index.pkl"]:
        path = os.path.join(VECTOR_DIR, name)
        if os.path.exists(path):
            os.remove(path)
    if os.path.exists(RAG_CHUNKS_PATH):
        os.remove(RAG_CHUNKS_PATH)


def save_chunk_records(chunks):
    with open(RAG_CHUNKS_PATH, "w", encoding="utf-8") as f:
        for chunk in chunks:
            f.write(json.dumps({
                "content": chunk.page_content,
                "metadata": chunk.metadata,
            }, ensure_ascii=False) + "\n")


def load_chunk_records(document_id: str | None = None):
    records = read_jsonl_file(RAG_CHUNKS_PATH)
    if document_id:
        records = [row for row in records if row.get("metadata", {}).get("document_id") == document_id]
    return records


RAG_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
    "how", "i", "in", "is", "it", "its", "main", "of", "on", "or", "that", "the",
    "their", "this", "to", "was", "were", "what", "when", "where", "which", "who",
    "why", "with", "your",
}


def save_raw_chunk_records(records):
    with open(RAG_CHUNKS_PATH, "w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def normalize_rag_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def rag_tokens(text: str):
    return [
        token
        for token in re.findall(r"[a-zA-Z0-9_+#.-]+", (text or "").lower())
        if len(token) > 1 and token not in RAG_STOPWORDS
    ]


def chunk_page_text(text: str, chunk_size: int = 1100, overlap: int = 180):
    text = normalize_rag_text(text)
    if not text:
        return []

    chunks = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_size)
        if end < len(text):
            boundary = max(text.rfind(". ", start, end), text.rfind(" ", start, end))
            if boundary > start + int(chunk_size * 0.55):
                end = boundary + 1

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end >= len(text):
            break
        start = max(0, end - overlap)

    return chunks


def extract_pdf_chunk_records(doc: RAGDocument):
    from pypdf import PdfReader

    reader = PdfReader(doc.path)
    records = []
    chunk_number = 1

    for page_index, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        for chunk_text in chunk_page_text(page_text):
            chunk_id = f"{doc.id}-chunk-{chunk_number}"
            records.append({
                "content": chunk_text,
                "metadata": {
                    "document_id": doc.id,
                    "document_name": doc.filename,
                    "chunk_id": chunk_id,
                    "page_number": page_index,
                    "owner": doc.owner,
                },
            })
            chunk_number += 1

    return records


def score_rag_records(question: str, records, top_k: int):
    question_tokens = rag_tokens(question)
    if not question_tokens:
        return []

    question_set = set(question_tokens)
    question_text = " ".join(question_tokens)
    scored = []

    for record in records:
        content = record.get("content", "")
        content_tokens = rag_tokens(content)
        if not content_tokens:
            continue

        content_set = set(content_tokens)
        overlap = question_set.intersection(content_set)
        if not overlap:
            continue

        content_lower = content.lower()
        exact_bonus = 2.0 if question_text and question_text in content_lower else 0.0
        coverage = len(overlap) / max(1, len(question_set))
        density = len(overlap) / max(1, len(content_set))
        score = round((coverage * 0.75) + (density * 0.25) + exact_bonus, 4)
        scored.append((score, record))

    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[: max(1, min(top_k, 12))]


def build_extractive_rag_answer(retrieved_chunks):
    if not retrieved_chunks:
        return "I could not find this information in the uploaded document."

    lines = ["I found this in the uploaded document:"]
    for item in retrieved_chunks:
        snippet = normalize_rag_text(item.get("content", ""))[:550]
        lines.append(f"[Source {item['rank']}] {snippet}")
    return "\n\n".join(lines)


def build_rag_index_fast(job_id: str, document_id: str | None = None):
    db = SessionLocal()

    try:
        with RAG_INDEX_LOCK:
            set_rag_job(
                job_id,
                status="running",
                message="Reading PDFs and creating persistent local chunks...",
                progress=10,
                documentId=document_id,
            )

            documents = db.query(RAGDocument).order_by(RAGDocument.uploaded_at.asc()).all()
            if not documents:
                clear_vector_store()
                set_rag_job(
                    job_id,
                    status="completed",
                    message="No RAG documents found. Local index cleared.",
                    progress=100,
                    totalChunks=0,
                    documentId=document_id,
                )
                return

            all_records = []
            total_docs = len(documents)

            for doc_index, doc in enumerate(documents, start=1):
                try:
                    doc.embedding_status = "indexing"
                    doc.error = ""
                    db.commit()

                    set_rag_job(
                        job_id,
                        status="running",
                        message=f"Extracting text from {doc.filename}...",
                        progress=10 + int((doc_index / max(1, total_docs)) * 70),
                        currentDocument=doc.filename,
                        documentId=document_id or doc.id,
                    )

                    if not doc.path or not os.path.exists(doc.path):
                        raise FileNotFoundError(f"PDF file missing: {doc.path}")

                    records = extract_pdf_chunk_records(doc)
                    doc.chunk_count = len(records)
                    doc.embedding_status = "indexed" if records else "failed"
                    doc.error = "" if records else "No readable text was found in this PDF."
                    doc.indexed_at = datetime.utcnow() if records else None
                    all_records.extend(records)
                    db.commit()

                except Exception as e:
                    doc.chunk_count = 0
                    doc.embedding_status = "failed"
                    doc.error = str(e)
                    db.commit()

            if not all_records:
                clear_vector_store()
                set_rag_job(
                    job_id,
                    status="failed",
                    message="No readable chunks were created from uploaded PDFs.",
                    progress=100,
                    totalChunks=0,
                    documentId=document_id,
                )
                return

            set_rag_job(
                job_id,
                status="running",
                message="Saving persistent local RAG index...",
                progress=90,
                totalChunks=len(all_records),
                documentId=document_id,
            )
            save_raw_chunk_records(all_records)

            set_rag_job(
                job_id,
                status="completed",
                message="RAG index is ready.",
                progress=100,
                totalChunks=len(all_records),
                documentId=document_id,
            )

    except Exception as e:
        set_rag_job(job_id, status="failed", message=str(e), progress=100, documentId=document_id)
    finally:
        db.close()


def build_vector_index(db: Session, document_id: str | None = None):
    from langchain_community.document_loaders import PyPDFLoader
    from langchain_community.vectorstores import FAISS
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    query = db.query(RAGDocument)
    if document_id:
        query = query.filter(RAGDocument.id == document_id)
    documents = query.order_by(RAGDocument.uploaded_at.asc()).all()

    if not documents:
        clear_vector_store()
        return 0

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=900,
        chunk_overlap=180,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    all_chunks = []

    for doc in documents:
        try:
            doc.embedding_status = "indexing"
            doc.error = ""
            db.commit()

            pages = PyPDFLoader(doc.path).load()
            split_docs = splitter.split_documents(pages)

            for index, chunk in enumerate(split_docs):
                page = chunk.metadata.get("page")
                chunk.metadata.update({
                    "document_id": doc.id,
                    "document_name": doc.filename,
                    "chunk_id": f"{doc.id}-chunk-{index + 1}",
                    "page_number": int(page) + 1 if page is not None else None,
                    "owner": doc.owner,
                })

            doc.chunk_count = len(split_docs)
            doc.embedding_status = "indexed"
            doc.indexed_at = datetime.utcnow()
            all_chunks.extend(split_docs)
            db.commit()
        except Exception as e:
            doc.embedding_status = "failed"
            doc.error = str(e)
            db.commit()

    if not all_chunks:
        clear_vector_store()
        return 0

    vectorstore = FAISS.from_documents(all_chunks, get_embeddings())
    vectorstore.save_local(VECTOR_DIR)
    save_chunk_records(all_chunks)
    return len(all_chunks)


def set_rag_job(job_id: str, **updates):
    current = RAG_JOBS.get(job_id, {"jobId": job_id})
    current.update(updates)
    current["updatedAt"] = datetime.utcnow().isoformat()
    RAG_JOBS[job_id] = current


def build_vector_index_safe(job_id: str, document_id: str | None = None):
    db = SessionLocal()

    try:
        with RAG_INDEX_LOCK:
            set_rag_job(
                job_id,
                status="running",
                message="Loading PDF documents and building chunks...",
                progress=10,
            )

            from langchain_community.document_loaders import PyPDFLoader
            from langchain_community.vectorstores import FAISS
            from langchain_text_splitters import RecursiveCharacterTextSplitter

            query = db.query(RAGDocument)
            if document_id:
                query = query.filter(RAGDocument.id == document_id)

            documents = query.order_by(RAGDocument.uploaded_at.asc()).all()

            if not documents:
                clear_vector_store()
                set_rag_job(
                    job_id,
                    status="completed",
                    message="No RAG documents found. Vector store cleared.",
                    progress=100,
                    totalChunks=0,
                )
                return

            splitter = RecursiveCharacterTextSplitter(
                chunk_size=700,
                chunk_overlap=120,
                separators=["\n\n", "\n", ". ", " ", ""],
            )

            all_chunks = []
            total_docs = len(documents)

            for doc_index, doc in enumerate(documents, start=1):
                try:
                    doc.embedding_status = "indexing"
                    doc.error = ""
                    db.commit()

                    set_rag_job(
                        job_id,
                        status="running",
                        message=f"Preprocessing {doc.filename}...",
                        progress=10 + int((doc_index / max(1, total_docs)) * 35),
                        currentDocument=doc.filename,
                        documentId=doc.id,
                    )

                    pages = PyPDFLoader(doc.path).load()
                    split_docs = splitter.split_documents(pages)

                    for index, chunk in enumerate(split_docs):
                        page = chunk.metadata.get("page")
                        chunk.metadata.update({
                            "document_id": doc.id,
                            "document_name": doc.filename,
                            "chunk_id": f"{doc.id}-chunk-{index + 1}",
                            "page_number": int(page) + 1 if page is not None else None,
                            "owner": doc.owner,
                        })

                    doc.chunk_count = len(split_docs)
                    doc.embedding_status = "chunked"
                    all_chunks.extend(split_docs)
                    db.commit()

                except Exception as e:
                    doc.embedding_status = "failed"
                    doc.error = str(e)
                    db.commit()

            if not all_chunks:
                clear_vector_store()
                set_rag_job(
                    job_id,
                    status="failed",
                    message="No chunks were created from the uploaded documents.",
                    progress=100,
                    totalChunks=0,
                )
                return

            set_rag_job(
                job_id,
                status="running",
                message="Creating embeddings and FAISS index...",
                progress=60,
                totalChunks=len(all_chunks),
            )
            for doc in documents:
                if doc.embedding_status != "failed":
                    doc.embedding_status = "embedding"
            db.commit()

            vectorstore = FAISS.from_documents(all_chunks, get_embeddings())

            set_rag_job(
                job_id,
                status="running",
                message="Saving FAISS index...",
                progress=85,
                totalChunks=len(all_chunks),
            )

            vectorstore.save_local(VECTOR_DIR)
            save_chunk_records(all_chunks)

            for doc in documents:
                if doc.embedding_status != "failed":
                    doc.embedding_status = "indexed"
                    doc.indexed_at = datetime.utcnow()
            db.commit()

            set_rag_job(
                job_id,
                status="completed",
                message="RAG index is ready.",
                progress=100,
                totalChunks=len(all_chunks),
            )

    except Exception as e:
        set_rag_job(job_id, status="failed", message=str(e), progress=100)
    finally:
        db.close()


@app.post("/rag/query")
def rag_query(req: RAGQuery):
    start_time = time.time()

    try:
        records = load_chunk_records(req.document_id)
        if not records:
            return {
                "status": "error",
                "message": "RAG index is not ready yet. Upload a PDF and wait until it shows indexed.",
            }

        scored_records = score_rag_records(req.question, records, req.top_k)

        retrieved_chunks = []
        for i, (score, record) in enumerate(scored_records):
            metadata = record.get("metadata", {}) or {}
            retrieved_chunks.append({
                "rank": i + 1,
                "score": float(score),
                "content": record.get("content", "")[:900],
                "documentId": metadata.get("document_id"),
                "documentName": metadata.get("document_name"),
                "pageNumber": metadata.get("page_number"),
                "chunkId": metadata.get("chunk_id"),
                "metadata": metadata,
            })

        context = "\n\n".join(
            [
                f"[Source {item['rank']}: {item['documentName']} page {item['pageNumber']} chunk {item['chunkId']}]\n{item['content']}"
                for item in retrieved_chunks
            ]
        )

        if not retrieved_chunks:
            return {
                "status": "success",
                "question": req.question,
                "answer": "I could not find this information in the uploaded document.",
                "retrieved_context": "",
                "sources": [],
                "citations": [],
                "metrics": {
                    "top_k": req.top_k,
                    "retrieved_chunks_count": 0,
                    "retrieval_relevance": 0,
                    "context_precision": 0,
                    "answer_quality": "not_found",
                    "retrieval_mode": "local_keyword",
                    "response_time_ms": round((time.time() - start_time) * 1000, 2),
                },
            }

        prompt = f"""
You are ModelForge RAG Assistant.

Answer the user's question using ONLY the uploaded document context below.
If the answer is not present in the context, say:
"I could not find this information in the uploaded document."

Keep the answer clear and concise. Include citation markers like [Source 1] when relevant.

DOCUMENT CONTEXT:
{context}

USER QUESTION:
{req.question}

FINAL ANSWER:
"""

        ollama_payload = {
            "model": RAG_LLM_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_ctx": 2048
            }
        }

        llm_status = "extractive grounded answer"
        answer = build_extractive_rag_answer(retrieved_chunks)

        if RAG_USE_OLLAMA:
            llm_status = f"{RAG_LLM_MODEL} via Ollama"
            try:
                ollama_response = requests.post(
                    "http://localhost:11434/api/generate",
                    json=ollama_payload,
                    timeout=20
                )
                ollama_response.raise_for_status()
                ollama_data = ollama_response.json()
                answer = ollama_data.get("response", "No answer generated.")
            except Exception as e:
                llm_status = f"extractive fallback; Ollama unavailable: {e}"
                answer = build_extractive_rag_answer(retrieved_chunks)

        return {
            "status": "success",
            "question": req.question,
            "answer": answer,
            "retrieved_context": context[:1500],
            "sources": retrieved_chunks,
            "citations": [
                {
                    "source": item["documentName"],
                    "page": item["pageNumber"],
                    "chunk": item["chunkId"],
                    "rank": item["rank"],
                }
                for item in retrieved_chunks
            ],
            "metrics": {
                "top_k": req.top_k,
                "retrieved_chunks_count": len(retrieved_chunks),
                "retrieval_relevance": max([item["score"] for item in retrieved_chunks], default=0),
                "context_precision": round(sum(1 for item in retrieved_chunks if item["score"] > 0.2) / max(1, len(retrieved_chunks)), 4),
                "answer_quality": "grounded" if retrieved_chunks else "not_found",
                "embedding_model": "none",
                "vector_db": "persistent_jsonl_keyword_index",
                "retrieval_mode": "local_keyword",
                "llm": llm_status,
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


class ColabExportConfig(BaseModel):
    datasetId: str
    baseModel: str = "unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit"
    trainingSteps: int = 60
    learningRate: float = 0.0002
    maxExamples: int = 500
    maxSeqLength: int = 1024
    loraR: int = 16
    loraAlpha: int = 16
    driveRoot: str = "/content/drive/MyDrive/ModelForge/jobs"


class KaggleExportConfig(BaseModel):
    datasetId: str
    kaggleUsername: str
    baseModel: str = "unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit"
    trainingSteps: int = 60
    learningRate: float = 0.0002
    maxExamples: int = 500
    maxSeqLength: int = 1024
    loraR: int = 16
    loraAlpha: int = 16


class KaggleRunConfig(BaseModel):
    jobId: str

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
        "kaggleConfigDir": KAGGLE_CONFIG_DIR,
    }


API_URL = "https://api-inference.huggingface.co/models/google/gemma-2b-it"
HF_TOKEN = os.getenv("HF_TOKEN", "")
headers = {
    "Authorization": f"Bearer {HF_TOKEN}"
}
@app.post("/chat")
def chat(req: ChatRequest):
    try:
        db = SessionLocal()
        runtime = resolve_model_runtime(req.model, db)
        db.close()

        if runtime["status"] == "not_deployed":
            return {
                "response": runtime["message"],
                "model_used": runtime.get("modelId", req.model),
            }

        if runtime["status"] == "error":
            model_name = "qwen2.5:1.5b"
        else:
            model_name = runtime["runtimeModel"]

        generated = ollama_generate(model_name, req.message)

        return {
            "response": generated,
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


@app.post("/models/import-adapter")
async def import_adapter(
    file: UploadFile = File(...),
    datasetId: str = Form(""),
    modelName: str = Form(""),
    db: Session = Depends(get_db),
):
    filename = safe_filename(file.filename)
    if not filename.lower().endswith(".zip"):
        return {"status": "error", "message": "Upload an adapter.zip file."}

    import_id = f"import-{uuid.uuid4().hex[:8]}"
    import_dir = os.path.join(IMPORTED_ADAPTER_DIR, import_id)
    os.makedirs(import_dir, exist_ok=True)
    zip_path = os.path.join(import_dir, filename)

    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extracted_dir = os.path.join(import_dir, "extracted")
    os.makedirs(extracted_dir, exist_ok=True)

    try:
        safe_extract_zip(zip_path, extracted_dir)
    except Exception as e:
        return {"status": "error", "message": f"Adapter zip could not be extracted: {str(e)}"}

    adapter_dir = find_adapter_dir(extracted_dir)
    if not adapter_dir:
        return {
            "status": "error",
            "message": "adapter_config.json and adapter_model.safetensors were not found in the zip.",
        }

    adapter_config = read_adapter_config(adapter_dir)
    adapter_base = adapter_config.get("base_model_name_or_path", "")
    if "qwen" not in adapter_base.lower():
        return {
            "status": "error",
            "message": f"Imported adapter is not a Qwen adapter. Found base model: {adapter_base or 'unknown'}",
            "adapterBase": adapter_base,
        }

    dataset = db.query(Dataset).filter(Dataset.id == datasetId).first() if datasetId else None
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    model_id = f"model-{uuid.uuid4().hex[:8]}"
    display_name = modelName.strip() or f"Custom Model - {dataset.name if dataset else import_id}"

    imported_job = TrainingJob(
        id=job_id,
        dataset_id=dataset.id if dataset else "",
        base_model=adapter_base,
        status="completed",
        training_steps=0,
        learning_rate=0.0,
        loss_history="",
        accuracy=0.0,
    )

    imported_model = FineTunedModel(
        id=model_id,
        name=display_name,
        base_model=adapter_base,
        adapter_path=adapter_dir,
        hf_repo="",
        accuracy=0.0,
    )

    db.add(imported_job)
    db.add(imported_model)
    db.commit()
    db.refresh(imported_job)
    db.refresh(imported_model)

    return {
        "status": "success",
        "message": "Qwen adapter imported and registered.",
        "model": serialize_model_record(imported_model, db),
        "trainingJob": serialize_training_job(imported_job, dataset),
        "adapterBase": adapter_base,
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
        models.append(serialize_model_record(model, db))

    return models


@app.get("/models/{model_id}")
def get_model_detail(model_id: str, db: Session = Depends(get_db)):
    model = db.query(FineTunedModel).filter(FineTunedModel.id == model_id).first()

    if not model:
        return {"status": "error", "message": "Model not found"}

    training_job = infer_training_job_for_model(model, db)
    dataset = db.query(Dataset).filter(Dataset.id == training_job.dataset_id).first() if training_job else None
    deployments = (
        db.query(Deployment)
        .filter(Deployment.model_id == model.id)
        .order_by(Deployment.created_at.desc())
        .all()
    )

    return {
        "status": "success",
        "model": serialize_model_record(model, db),
        "trainingJob": serialize_training_job(training_job, dataset) if training_job else None,
        "dataset": {
            "id": dataset.id,
            "name": dataset.name,
            "format": dataset.format,
            "rows": dataset.rows_count,
            "path": dataset.path,
        } if dataset else None,
        "deployments": [serialize_deployment(item) for item in deployments],
    }


@app.post("/models/{model_id}/test")
def test_registered_model(model_id: str, req: ModelTestRequest, db: Session = Depends(get_db)):
    runtime = resolve_model_runtime(model_id, db)

    if runtime["status"] != "ready":
        return {
            "status": runtime["status"],
            "message": runtime["message"],
            "response": runtime["message"],
            "model_used": runtime.get("modelId", model_id),
        }

    try:
        generated = ollama_generate(runtime["runtimeModel"], req.prompt)
        return {
            "status": "success",
            "response": generated,
            "model_used": runtime["runtimeModel"],
            "runtime": runtime["runtime"],
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "response": f"Ollama inference failed for {runtime['runtimeModel']}: {str(e)}",
            "model_used": runtime["runtimeModel"],
        }


@app.post("/models/{model_id}/deploy/ollama")
def register_ollama_deployment(model_id: str, req: ModelDeployRequest, db: Session = Depends(get_db)):
    model = db.query(FineTunedModel).filter(FineTunedModel.id == model_id).first()

    if not model:
        return {"status": "error", "message": "Model not found"}

    resolved_adapter_path = resolve_artifact_path(model.adapter_path)
    if not model.adapter_path or not os.path.exists(resolved_adapter_path):
        return {
            "status": "error",
            "message": "Adapter artifact is missing on disk. Cannot deploy this model.",
        }

    base_runtime_model = req.baseRuntimeModel.strip() or "qwen2.5:1.5b"
    artifact = adapter_artifact_report(model.adapter_path, base_runtime_model)
    if not artifact["deployReady"]:
        return {
            "status": "error",
            "message": artifact["deployBlocker"],
            "adapterBase": artifact["adapterBase"],
        }

    runtime_model = req.ollamaModel.strip() or default_ollama_model_name(model, db)
    deployment_id = f"dep-{uuid.uuid4().hex[:8]}"
    deployment_dir = os.path.join(DEPLOYMENT_DIR, deployment_id)
    os.makedirs(deployment_dir, exist_ok=True)
    modelfile_path = os.path.join(deployment_dir, "Modelfile")
    copied_files = copy_adapter_artifact(resolved_adapter_path, deployment_dir)
    write_ollama_modelfile(
        modelfile_path,
        base_runtime_model,
        "adapter_model.safetensors",
    )

    training_job = infer_training_job_for_model(model, db)
    deployment = Deployment(
        id=deployment_id,
        model_id=model.id,
        training_job_id=training_job.id if training_job else "",
        runtime="ollama",
        runtime_model=runtime_model,
        adapter_path=resolved_adapter_path,
        modelfile_path=modelfile_path,
        status="creating",
        logs=json.dumps({"copiedFiles": copied_files}, indent=2),
    )
    db.add(deployment)
    db.commit()
    db.refresh(deployment)

    try:
        result = run_command(["ollama", "create", runtime_model, "-f", "Modelfile"], cwd=deployment_dir)
    except Exception as e:
        message = process_error_message(str(e), str(e))
        deployment.status = "failed"
        deployment.logs = message
        deployment.updated_at = datetime.utcnow()
        db.commit()
        return {
            "status": "error",
            "message": f"Ollama deployment failed: {message}",
            "deployment": serialize_deployment(deployment),
        }

    deployment.logs = json.dumps(result, indent=2)
    deployment.updated_at = datetime.utcnow()

    if result["returncode"] != 0:
        deployment.status = "failed"
        db.commit()
        message = process_error_message(result["stderr"] or result["stdout"], "Ollama create failed.")
        return {
            "status": "error",
            "message": message,
            "deployment": serialize_deployment(deployment),
        }

    deployment.status = "deployed"
    model.hf_repo = f"ollama:{runtime_model}"
    db.commit()
    db.refresh(deployment)
    db.refresh(model)

    return {
        "status": "success",
        "message": f"ModelForge adapter deployed as Ollama model '{runtime_model}'.",
        "modelId": model.id,
        "runtimeModel": runtime_model,
        "adapterPath": resolved_adapter_path,
        "deployment": serialize_deployment(deployment),
    }


@app.post("/models/{model_id}/deploy")
def deploy_model(model_id: str, req: ModelDeployRequest, db: Session = Depends(get_db)):
    return register_ollama_deployment(model_id, req, db)


@app.post("/models/{model_id}/bind/ollama")
def bind_existing_ollama_runtime(model_id: str, req: ModelRuntimeBindRequest, db: Session = Depends(get_db)):
    model = db.query(FineTunedModel).filter(FineTunedModel.id == model_id).first()

    if not model:
        return {"status": "error", "message": "Model not found"}

    runtime_model = req.ollamaModel.strip()
    if not runtime_model:
        return {"status": "error", "message": "Provide an existing Ollama model name."}

    artifact = adapter_artifact_report(model.adapter_path, req.baseRuntimeModel.strip() or "qwen2.5:1.5b")
    if not artifact["deployReady"]:
        return {
            "status": "error",
            "message": artifact["deployBlocker"],
            "adapterBase": artifact["adapterBase"],
        }

    if not ollama_model_exists(runtime_model):
        return {
            "status": "error",
            "message": f"Ollama model '{runtime_model}' was not found locally. Run `ollama list` to confirm available names.",
        }

    training_job = infer_training_job_for_model(model, db)
    deployment = Deployment(
        id=f"dep-{uuid.uuid4().hex[:8]}",
        model_id=model.id,
        training_job_id=training_job.id if training_job else "",
        runtime="ollama",
        runtime_model=runtime_model,
        adapter_path=artifact["resolvedAdapterPath"],
        modelfile_path="",
        status="deployed",
        logs=json.dumps({
            "mode": "existing_runtime_binding",
            "message": "Bound this registered adapter entry to an existing local Ollama runtime.",
            "runtimeModel": runtime_model,
            "adapterPath": artifact["resolvedAdapterPath"],
        }, indent=2),
    )

    db.add(deployment)
    model.hf_repo = f"ollama:{runtime_model}"
    db.commit()
    db.refresh(deployment)
    db.refresh(model)

    return {
        "status": "success",
        "message": f"Bound '{model.name}' to existing Ollama runtime '{runtime_model}'.",
        "modelId": model.id,
        "runtimeModel": runtime_model,
        "deployment": serialize_deployment(deployment),
    }


@app.get("/models/{model_id}/load")
def load_model_for_inference(model_id: str, db: Session = Depends(get_db)):
    runtime = resolve_model_runtime(model_id, db)
    return runtime


@app.get("/deployments")
def list_deployments(db: Session = Depends(get_db)):
    deployments = db.query(Deployment).order_by(Deployment.created_at.desc()).all()
    return {
        "status": "success",
        "deployments": [serialize_deployment(item) for item in deployments],
    }


@app.get("/pipeline/status")
def pipeline_status(db: Session = Depends(get_db)):
    datasets = db.query(Dataset).order_by(Dataset.uploaded_at.desc()).all()
    latest_dataset = datasets[0] if datasets else None
    latest_job = db.query(TrainingJob).order_by(TrainingJob.created_at.desc()).first()
    models = db.query(FineTunedModel).order_by(FineTunedModel.created_at.desc()).all()
    latest_model = models[0] if models else None
    vector_index_exists = os.path.exists(RAG_CHUNKS_PATH) and len(load_chunk_records()) > 0

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


@app.post("/colab/export")
def export_colab_package(config: ColabExportConfig, db: Session = Depends(get_db)):
    dataset = db.query(Dataset).filter(Dataset.id == config.datasetId).first()

    if not dataset:
        return {"status": "error", "message": "Dataset not found"}

    if not dataset.path or not os.path.exists(dataset.path):
        return {"status": "error", "message": "Dataset file is missing on disk"}

    job_id = f"colab-{uuid.uuid4().hex[:8]}"
    export_dir = os.path.join(COLAB_EXPORT_DIR, job_id)
    os.makedirs(export_dir, exist_ok=True)

    rows = read_dataset_rows(dataset.path)
    texts = []

    for row in rows[: config.maxExamples]:
        text = format_training_text(row)
        if text:
            texts.append(text)

    if not texts:
        return {
            "status": "error",
            "message": "No valid examples found. Expected prompt/completion, instruction/response, or question/answer columns.",
        }

    dataset_export_path = os.path.join(export_dir, "dataset.jsonl")
    with open(dataset_export_path, "w", encoding="utf-8") as f:
        for text in texts:
            f.write(json.dumps({"text": text}, ensure_ascii=False) + "\n")

    drive_job_dir = f"{config.driveRoot.rstrip('/')}/{job_id}"
    export_config = {
        "job_id": job_id,
        "source_dataset_id": dataset.id,
        "source_dataset_name": dataset.name,
        "base_model": config.baseModel,
        "training_steps": config.trainingSteps,
        "learning_rate": config.learningRate,
        "max_examples": config.maxExamples,
        "examples_exported": len(texts),
        "max_seq_length": config.maxSeqLength,
        "lora_r": config.loraR,
        "lora_alpha": config.loraAlpha,
        "drive_job_dir": drive_job_dir,
        "created_at": datetime.utcnow().isoformat(),
        "mode": "remote-colab-unsloth-qlora",
    }

    config_path = os.path.join(export_dir, "config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(export_config, f, indent=2)

    notebook_path = os.path.join(export_dir, "colab_train.ipynb")
    write_colab_notebook(notebook_path, job_id, drive_job_dir)

    readme_path = os.path.join(export_dir, "README.txt")
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(
            "ModelForge Colab QLoRA package\n\n"
            "1. Create this folder in Google Drive:\n"
            f"   {drive_job_dir}\n\n"
            "2. Upload dataset.jsonl, config.json, and colab_train.ipynb into that folder.\n"
            "3. Open colab_train.ipynb in Google Colab with a GPU runtime.\n"
            "4. Run all cells. The adapter will be saved into the Drive job folder.\n"
        )

    return {
        "status": "success",
        "message": "Colab QLoRA package generated.",
        "jobId": job_id,
        "exportDir": export_dir,
        "driveJobDir": drive_job_dir,
        "files": {
            "dataset": dataset_export_path,
            "config": config_path,
            "notebook": notebook_path,
            "readme": readme_path,
        },
        "examplesExported": len(texts),
    }


@app.post("/kaggle/export")
def export_kaggle_package(config: KaggleExportConfig, db: Session = Depends(get_db)):
    dataset = db.query(Dataset).filter(Dataset.id == config.datasetId).first()

    if not dataset:
        return {"status": "error", "message": "Dataset not found"}

    if not dataset.path or not os.path.exists(dataset.path):
        return {"status": "error", "message": "Dataset file is missing on disk"}

    username = "".join(c.lower() if c.isalnum() or c in "-_" else "-" for c in config.kaggleUsername.strip())
    if not username:
        return {"status": "error", "message": "Kaggle username is required"}

    job_id = f"kaggle-{uuid.uuid4().hex[:8]}"
    dataset_slug = f"modelforge-{job_id}-data"
    kernel_slug = f"modelforge-{job_id}-qlora"
    dataset_ref = f"{username}/{dataset_slug}"
    kernel_ref = f"{username}/{kernel_slug}"

    job_dir = os.path.join(KAGGLE_EXPORT_DIR, job_id)
    dataset_dir = os.path.join(job_dir, "dataset")
    kernel_dir = os.path.join(job_dir, "kernel")
    output_dir = os.path.join(job_dir, "output")
    os.makedirs(dataset_dir, exist_ok=True)
    os.makedirs(kernel_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    rows = read_dataset_rows(dataset.path)
    texts = []

    for row in rows[: config.maxExamples]:
        text = format_training_text(row)
        if text:
            texts.append(text)

    if not texts:
        return {
            "status": "error",
            "message": "No valid examples found. Expected prompt/completion, instruction/response, or question/answer columns.",
        }

    dataset_export_path = os.path.join(dataset_dir, "dataset.jsonl")
    with open(dataset_export_path, "w", encoding="utf-8") as f:
        for text in texts:
            f.write(json.dumps({"text": text}, ensure_ascii=False) + "\n")

    export_config = {
        "job_id": job_id,
        "source_dataset_id": dataset.id,
        "source_dataset_name": dataset.name,
        "base_model": config.baseModel,
        "training_steps": config.trainingSteps,
        "learning_rate": config.learningRate,
        "max_examples": config.maxExamples,
        "examples_exported": len(texts),
        "max_seq_length": config.maxSeqLength,
        "lora_r": config.loraR,
        "lora_alpha": config.loraAlpha,
        "kaggle_dataset": dataset_ref,
        "kaggle_kernel": kernel_ref,
        "created_at": datetime.utcnow().isoformat(),
        "mode": "remote-kaggle-unsloth-qlora",
    }

    config_path = os.path.join(dataset_dir, "config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(export_config, f, indent=2)

    dataset_metadata_path = os.path.join(dataset_dir, "dataset-metadata.json")
    with open(dataset_metadata_path, "w", encoding="utf-8") as f:
        json.dump({
            "id": dataset_ref,
            "title": f"ModelForge {job_id} Training Data",
            "licenses": [{"name": "CC0-1.0"}],
        }, f, indent=2)

    script_path = os.path.join(kernel_dir, "kaggle_train.py")
    notebook_path = os.path.join(kernel_dir, "kaggle_train.ipynb")
    write_kaggle_training_script(script_path)
    write_kaggle_notebook(notebook_path)

    kernel_metadata_path = os.path.join(kernel_dir, "kernel-metadata.json")
    with open(kernel_metadata_path, "w", encoding="utf-8") as f:
        json.dump({
            "id": kernel_ref,
            "title": f"ModelForge {job_id} QLoRA",
            "code_file": "kaggle_train.ipynb",
            "language": "python",
            "kernel_type": "notebook",
            "is_private": True,
            "enable_gpu": True,
            "enable_internet": True,
            "dataset_sources": [dataset_ref],
            "competition_sources": [],
            "kernel_sources": [],
        }, f, indent=2)

    readme_path = os.path.join(job_dir, "README.txt")
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(
            "ModelForge Kaggle GPU package\n\n"
            "Kaggle auth setup for ModelForge:\n"
            f"1. Use this local Kaggle config folder: {KAGGLE_CONFIG_DIR}\n"
            "2. Recommended OAuth setup from backend folder:\n"
            f"   $env:KAGGLE_CONFIG_DIR=\"{KAGGLE_CONFIG_DIR}\"\n"
            "   venv\\Scripts\\python.exe -m kaggle auth login\n"
            "3. Or use Kaggle Settings > API token and follow the Kaggle CLI token instructions.\n\n"
            "Automatic path:\n"
            f"1. POST /kaggle/run with jobId={job_id}.\n"
            "2. Poll /kaggle/status/{job_id} until Kaggle marks the kernel complete.\n"
            f"3. POST /kaggle/download with jobId={job_id} to fetch outputs.\n\n"
            "Manual CLI fallback:\n"
            f"1. kaggle datasets create -p \"{dataset_dir}\" --dir-mode zip\n"
            f"2. kaggle kernels push -p \"{kernel_dir}\"\n"
            f"3. kaggle kernels status {kernel_ref}\n"
            f"4. kaggle kernels output {kernel_ref} -p \"{output_dir}\"\n"
        )

    state = write_kaggle_state(job_id, {
        "status": "prepared",
        "message": "Kaggle package is ready. Submit it from ModelForge after Kaggle API credentials are configured.",
        "jobId": job_id,
        "datasetRef": dataset_ref,
        "kernelRef": kernel_ref,
        "jobDir": job_dir,
        "datasetDir": dataset_dir,
        "kernelDir": kernel_dir,
        "outputDir": output_dir,
        "examplesExported": len(texts),
    })

    return {
        "status": "success",
        "message": "Kaggle GPU package generated.",
        **state,
        "files": {
            "dataset": dataset_export_path,
            "config": config_path,
            "datasetMetadata": dataset_metadata_path,
            "kernelMetadata": kernel_metadata_path,
            "script": script_path,
            "notebook": notebook_path,
            "readme": readme_path,
        },
    }


@app.post("/kaggle/run")
def submit_kaggle_job(config: KaggleRunConfig):
    job_dir = os.path.join(KAGGLE_EXPORT_DIR, config.jobId)
    if not os.path.exists(job_dir):
        return {"status": "error", "message": "Kaggle job package not found"}

    write_kaggle_state(config.jobId, {
        "status": "queued",
        "message": "Kaggle submission queued in ModelForge.",
    })
    threading.Thread(target=run_kaggle_job, args=(config.jobId,), daemon=True).start()
    return read_kaggle_state(config.jobId)


@app.get("/kaggle/status/{job_id}")
def kaggle_job_status(job_id: str):
    state = read_kaggle_state(job_id)
    kernel_ref = state.get("kernelRef")

    if kernel_ref and state.get("status") in ["running", "submitting_kernel"]:
        status_result = run_command([sys.executable, "-m", "kaggle", "kernels", "status", kernel_ref])
        state = write_kaggle_state(job_id, {
            "kaggleStatus": status_result,
            "message": status_result["stdout"].strip() or status_result["stderr"].strip() or state.get("message"),
        })

    return state


@app.post("/kaggle/download")
def download_kaggle_output(config: KaggleRunConfig):
    state = read_kaggle_state(config.jobId)
    kernel_ref = state.get("kernelRef")
    output_dir = state.get("outputDir") or os.path.join(KAGGLE_EXPORT_DIR, config.jobId, "output")

    if not kernel_ref:
        return {"status": "error", "message": "Kaggle kernel reference missing"}

    os.makedirs(output_dir, exist_ok=True)
    result = run_command([sys.executable, "-m", "kaggle", "kernels", "output", kernel_ref, "-p", output_dir])

    if result["returncode"] != 0:
        return write_kaggle_state(config.jobId, {
            "status": "download_failed",
            "message": result["stderr"] or result["stdout"] or "Kaggle output download failed.",
            "download": result,
        })

    files = []
    for root, _dirs, names in os.walk(output_dir):
        for name in names:
            files.append(os.path.join(root, name))

    return write_kaggle_state(config.jobId, {
        "status": "downloaded",
        "message": "Kaggle outputs downloaded into ModelForge.",
        "download": result,
        "outputFiles": files,
    })

@app.post("/rag/upload")
def upload_rag_document(file: UploadFile = File(...), owner: str = Form("local-user"), db: Session = Depends(get_db)):
    try:
        filename = safe_filename(file.filename)
        if not filename.lower().endswith(".pdf"):
            return {"status": "error", "message": "Only PDF files are supported."}

        document_id = f"doc-{uuid.uuid4().hex[:8]}"
        file_path = os.path.join(RAG_UPLOAD_DIR, f"{uuid.uuid4().hex[:8]}-{filename}")

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        content_hash = file_sha256(file_path)
        existing = (
            db.query(RAGDocument)
            .filter(RAGDocument.owner == owner, RAGDocument.content_hash == content_hash)
            .first()
        )
        if existing:
            os.remove(file_path)
            if existing.embedding_status != "indexed":
                job_id = f"rag-job-{uuid.uuid4().hex[:8]}"
                set_rag_job(
                    job_id,
                    status="queued",
                    message="Duplicate document found, but index is not ready. Reindex queued.",
                    progress=0,
                    documentId=existing.id,
                )
                threading.Thread(target=build_rag_index_fast, args=(job_id, existing.id), daemon=True).start()
                return {
                    "status": "success",
                    "message": "Duplicate document found. Reindex started.",
                    "document": serialize_rag_document(existing),
                    "filename": existing.filename,
                    "chunks": existing.chunk_count,
                    "jobId": job_id,
                    "duplicate": True,
                }

            return {
                "status": "success",
                "message": "Document already indexed. Duplicate upload skipped.",
                "document": serialize_rag_document(existing),
                "filename": existing.filename,
                "chunks": existing.chunk_count,
                "jobId": None,
                "duplicate": True,
            }

        doc = RAGDocument(
            id=document_id,
            filename=filename,
            owner=owner,
            path=file_path,
            content_hash=content_hash,
            embedding_status="pending",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        job_id = f"rag-job-{uuid.uuid4().hex[:8]}"
        set_rag_job(
            job_id,
            status="queued",
            message="Document uploaded. Indexing queued.",
            progress=0,
            documentId=document_id,
            filename=filename,
        )
        threading.Thread(target=build_rag_index_fast, args=(job_id, document_id), daemon=True).start()

        return {
            "status": "success",
            "document": serialize_rag_document(doc),
            "filename": filename,
            "chunks": doc.chunk_count,
            "jobId": job_id,
            "message": "Document uploaded. Indexing started in background."
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }


@app.get("/rag/documents")
def list_rag_documents(db: Session = Depends(get_db)):
    docs = db.query(RAGDocument).order_by(RAGDocument.uploaded_at.desc()).all()
    return {
        "status": "success",
        "documents": [serialize_rag_document(doc) for doc in docs],
        "indexExists": os.path.exists(RAG_CHUNKS_PATH),
        "chunkRecords": len(load_chunk_records()),
    }


@app.get("/rag/documents/{document_id}")
def get_rag_document(document_id: str, db: Session = Depends(get_db)):
    doc = db.query(RAGDocument).filter(RAGDocument.id == document_id).first()
    if not doc:
        return {"status": "error", "message": "Document not found"}

    return {
        "status": "success",
        "document": serialize_rag_document(doc),
        "chunks": load_chunk_records(document_id)[:50],
    }


@app.get("/rag/jobs/{job_id}")
def get_rag_job_status(job_id: str, db: Session = Depends(get_db)):
    job = RAG_JOBS.get(job_id)
    if not job:
        return {"status": "error", "message": "RAG job not found."}

    document_id = job.get("documentId")
    if document_id:
        doc = db.query(RAGDocument).filter(RAGDocument.id == document_id).first()
        if doc:
            if doc.embedding_status == "chunked" and job.get("progress", 0) < 60:
                set_rag_job(
                    job_id,
                    status="running",
                    message="Chunks created. Saving local RAG index...",
                    progress=60,
                    totalChunks=doc.chunk_count,
                    documentId=document_id,
                )
                job = RAG_JOBS[job_id]
            elif doc.embedding_status == "embedding" and job.get("progress", 0) < 60:
                set_rag_job(
                    job_id,
                    status="running",
                    message="Saving local RAG index...",
                    progress=60,
                    totalChunks=doc.chunk_count,
                    documentId=document_id,
                )
                job = RAG_JOBS[job_id]
            elif doc.embedding_status == "indexed":
                set_rag_job(
                    job_id,
                    status="completed",
                    message="RAG index is ready.",
                    progress=100,
                    totalChunks=doc.chunk_count,
                    documentId=document_id,
                )
                job = RAG_JOBS[job_id]
            elif doc.embedding_status == "failed":
                set_rag_job(
                    job_id,
                    status="failed",
                    message=doc.error or "Document indexing failed.",
                    progress=100,
                    documentId=document_id,
                )
                job = RAG_JOBS[job_id]

    return {"status": "success", "job": job}


@app.delete("/rag/documents/{document_id}")
def delete_rag_document(document_id: str, db: Session = Depends(get_db)):
    doc = db.query(RAGDocument).filter(RAGDocument.id == document_id).first()
    if not doc:
        return {"status": "error", "message": "Document not found"}

    if doc.path and os.path.exists(doc.path):
        os.remove(doc.path)

    db.delete(doc)
    db.commit()
    job_id = f"rag-job-{uuid.uuid4().hex[:8]}"
    set_rag_job(job_id, status="queued", message="Document deleted. Reindex queued.", progress=0)
    threading.Thread(target=build_rag_index_fast, args=(job_id, None), daemon=True).start()

    return {
        "status": "success",
        "message": "Document deleted. Reindex started in background.",
        "jobId": job_id,
    }


@app.post("/rag/rebuild")
def rebuild_rag_index(req: RAGRebuildRequest = RAGRebuildRequest()):
    job_id = f"rag-job-{uuid.uuid4().hex[:8]}"
    set_rag_job(
        job_id,
        status="queued",
        message="RAG rebuild queued.",
        progress=0,
        documentId=req.document_id,
    )
    threading.Thread(target=build_rag_index_fast, args=(job_id, req.document_id), daemon=True).start()
    return {
        "status": "success",
        "message": "RAG rebuild started in background.",
        "jobId": job_id,
    }


@app.get("/rag/sources")
def retrieve_rag_sources(question: str, top_k: int = 4, document_id: str | None = None):
    result = rag_query(RAGQuery(question=question, top_k=top_k, document_id=document_id))
    if result.get("status") == "error":
        return result
    return {
        "status": "success",
        "question": question,
        "sources": result.get("sources", []),
        "citations": result.get("citations", []),
        "metrics": result.get("metrics", {}),
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
