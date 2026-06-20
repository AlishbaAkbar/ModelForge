import csv
import json
import os
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GENERATED_DIR = os.path.join(BASE_DIR, "generated_datasets")
ARTIFACT_DIR = os.path.join(BASE_DIR, "artifacts")


def _resolve_dataset_path(dataset_id, explicit_path=None):
    if explicit_path and os.path.exists(explicit_path):
        return explicit_path

    generated_path = os.path.join(GENERATED_DIR, f"{dataset_id}.jsonl")
    if os.path.exists(generated_path):
        return generated_path

    return None


def _append_jsonl(path, payload):
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(payload) + "\n")


def _write_manifest(path, payload):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def _read_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def _read_csv(path):
    with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
        return list(csv.DictReader(f))


def _pick(row, *keys):
    for key in keys:
        value = row.get(key)
        if value:
            return str(value).strip()
    return ""


def _format_example(row):
    instruction = _pick(row, "instruction", "prompt", "question", "input_text", "source")
    input_text = _pick(row, "input", "context")
    response = _pick(row, "response", "completion", "answer", "output", "target")

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


def _load_training_texts(path, max_examples=512):
    ext = path.split(".")[-1].lower()
    rows = _read_jsonl(path) if ext == "jsonl" else _read_csv(path)
    texts = []

    for row in rows[:max_examples]:
        text = _format_example(row)
        if text:
            texts.append(text)

    if not texts:
        raise ValueError("No valid training examples found. Expected prompt/completion, instruction/response, or question/answer columns.")

    return texts


def _select_hf_model(base_model):
    override = os.getenv("MODEL_FORGE_HF_MODEL", "").strip()
    if override:
        return override

    aliases = {
        "qwen2.5:1.5b": "Qwen/Qwen2.5-0.5B-Instruct",
        "base-gemma": "Qwen/Qwen2.5-0.5B-Instruct",
        "gemma-2b": "google/gemma-2b-it",
        "Gemma 2B": "google/gemma-2b-it",
    }

    try:
        import torch

        if not torch.cuda.is_available():
            return os.getenv("MODEL_FORGE_CPU_DEV_MODEL", "sshleifer/tiny-gpt2")
    except Exception:
        return os.getenv("MODEL_FORGE_CPU_DEV_MODEL", "sshleifer/tiny-gpt2")

    return aliases.get(base_model, base_model)


def _target_modules_for(model_name):
    lowered = model_name.lower()

    if "qwen" in lowered or "llama" in lowered or "mistral" in lowered:
        return ["q_proj", "k_proj", "v_proj", "o_proj"]

    if "gpt2" in lowered:
        return ["c_attn", "c_proj"]

    return ["q_proj", "v_proj"]


def _guard_cpu_model_choice(model_name):
    try:
        import torch
    except Exception:
        return

    if torch.cuda.is_available():
        return

    if os.getenv("MODEL_FORGE_ALLOW_CPU_LARGE_MODEL", "0") == "1":
        return

    lowered = model_name.lower()
    blocked = ["qwen", "gemma", "llama", "mistral"]

    if any(name in lowered for name in blocked):
        raise RuntimeError(
            "This machine is running CPU-only PyTorch. Large instruction models "
            f"like '{model_name}' are too slow for local CPU fine-tuning. "
            "Use 'sshleifer/tiny-gpt2' for local pipeline tests, or run on a CUDA GPU. "
            "To force CPU anyway, set MODEL_FORGE_ALLOW_CPU_LARGE_MODEL=1."
        )


def _set_job_status(job_id, status, loss_history=None):
    from database import SessionLocal
    from model import TrainingJob

    db = SessionLocal()
    job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()

    if job:
        job.status = status
        if loss_history is not None:
            job.loss_history = ",".join(str(value) for value in loss_history)
        db.commit()

    db.close()


def _register_model(job_id, base_model, adapter_path):
    from database import SessionLocal
    from model import FineTunedModel

    db = SessionLocal()
    model_id = f"model-{job_id.replace('job-', '')}"
    existing_model = db.query(FineTunedModel).filter(FineTunedModel.id == model_id).first()

    if not existing_model:
        db.add(FineTunedModel(
            id=model_id,
            name=f"ModelForge Adapter {job_id[-8:]}",
            base_model=base_model,
            adapter_path=adapter_path,
            hf_repo="",
            accuracy=0.0,
        ))
        db.commit()

    db.close()


def _stage_manifest(
    manifest_path,
    job_id,
    dataset_id,
    dataset_path,
    base_model,
    hf_model_name,
    status,
    message,
    **extra,
):
    payload = {
        "job_id": job_id,
        "dataset_id": dataset_id,
        "dataset_path": dataset_path,
        "base_model": base_model,
        "hf_model": hf_model_name,
        "status": status,
        "message": message,
        "updated_at": datetime.utcnow().isoformat(),
    }
    payload.update(extra)
    _write_manifest(manifest_path, payload)


def run_training(job_id, dataset_id, dataset_path=None, total_steps=30, learning_rate=0.00005, overrides=None):
    from database import SessionLocal
    from model import TrainingJob

    overrides = overrides or {}
    db = SessionLocal()
    job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()

    if not job:
        db.close()
        return

    resolved_path = _resolve_dataset_path(dataset_id, dataset_path)

    if not resolved_path:
        job.status = "failed"
        db.commit()
        db.close()
        return

    base_model = job.base_model
    db.close()

    run_dir = os.path.join(ARTIFACT_DIR, "training_runs", job_id)
    adapter_dir = os.path.join(run_dir, "adapter")
    logs_dir = os.path.join(run_dir, "logs")
    metrics_path = os.path.join(run_dir, "metrics.jsonl")
    manifest_path = os.path.join(run_dir, "adapter_manifest.json")

    os.makedirs(adapter_dir, exist_ok=True)
    os.makedirs(logs_dir, exist_ok=True)

    losses = []
    hf_model_name = overrides.get("hf_model") or _select_hf_model(base_model)
    max_examples = int(overrides.get("max_examples") or os.getenv("MODEL_FORGE_MAX_EXAMPLES", "512"))
    max_seq_length = int(overrides.get("max_seq_length") or os.getenv("MODEL_FORGE_MAX_SEQ_LENGTH", "256"))
    trust_remote_code = os.getenv("MODEL_FORGE_TRUST_REMOTE_CODE", "0") == "1"

    _set_job_status(job_id, "running", losses)
    _stage_manifest(
        manifest_path,
        job_id,
        dataset_id,
        resolved_path,
        base_model,
        hf_model_name,
        "initializing",
        "Preparing training run.",
        created_at=datetime.utcnow().isoformat(),
    )

    try:
        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "initializing",
            "Checking hardware and model choice.",
        )
        _guard_cpu_model_choice(hf_model_name)

        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "initializing",
            "Importing Hugging Face training libraries.",
        )
        from datasets import Dataset as HFDataset
        from peft import LoraConfig, TaskType, get_peft_model
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            DataCollatorForLanguageModeling,
            Trainer,
            TrainerCallback,
            TrainingArguments,
        )
        import torch

        class LossCallback(TrainerCallback):
            def on_log(self, args, state, control, logs=None, **kwargs):
                if not logs or "loss" not in logs:
                    return

                loss = round(float(logs["loss"]), 4)
                losses.append(loss)
                _set_job_status(job_id, "running", losses)
                _append_jsonl(metrics_path, {
                    "step": int(state.global_step),
                    "target_training_steps": total_steps,
                    "loss": loss,
                    "learning_rate": learning_rate,
                    "timestamp": datetime.utcnow().isoformat(),
                })

        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "initializing",
            "Loading and formatting training examples.",
            max_examples=max_examples,
            max_seq_length=max_seq_length,
        )
        texts = _load_training_texts(resolved_path, max_examples=max_examples)
        dataset = HFDataset.from_dict({"text": texts})

        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "initializing",
            "Loading tokenizer. First run may download model files.",
            examples_used=len(texts),
            max_seq_length=max_seq_length,
        )
        tokenizer = AutoTokenizer.from_pretrained(
            hf_model_name,
            trust_remote_code=trust_remote_code,
        )
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        def tokenize(batch):
            return tokenizer(
                batch["text"],
                truncation=True,
                max_length=max_seq_length,
                padding=False,
            )

        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "initializing",
            "Tokenizing training examples.",
            examples_used=len(texts),
            max_seq_length=max_seq_length,
        )
        tokenized = dataset.map(tokenize, batched=True, remove_columns=["text"])

        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "initializing",
            "Loading base model weights. First run may download model files.",
            examples_used=len(texts),
            max_seq_length=max_seq_length,
            device="cuda" if torch.cuda.is_available() else "cpu",
        )
        model = AutoModelForCausalLM.from_pretrained(
            hf_model_name,
            trust_remote_code=trust_remote_code,
            torch_dtype=dtype,
        )
        model.config.use_cache = False

        lora_config = LoraConfig(
            r=int(overrides.get("lora_r") or os.getenv("MODEL_FORGE_LORA_R", "8")),
            lora_alpha=int(overrides.get("lora_alpha") or os.getenv("MODEL_FORGE_LORA_ALPHA", "16")),
            lora_dropout=float(os.getenv("MODEL_FORGE_LORA_DROPOUT", "0.05")),
            bias="none",
            task_type=TaskType.CAUSAL_LM,
            target_modules=_target_modules_for(hf_model_name),
        )
        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "initializing",
            "Applying LoRA adapter configuration.",
            examples_used=len(texts),
            max_seq_length=max_seq_length,
            device="cuda" if torch.cuda.is_available() else "cpu",
            lora={
                "r": lora_config.r,
                "alpha": lora_config.lora_alpha,
                "dropout": lora_config.lora_dropout,
                "target_modules": _target_modules_for(hf_model_name),
            },
        )
        model = get_peft_model(model, lora_config)

        training_args = TrainingArguments(
            output_dir=logs_dir,
            max_steps=max(1, int(total_steps)),
            per_device_train_batch_size=int(overrides.get("batch_size") or os.getenv("MODEL_FORGE_BATCH_SIZE", "1")),
            gradient_accumulation_steps=int(overrides.get("grad_accum") or os.getenv("MODEL_FORGE_GRAD_ACCUM", "1")),
            learning_rate=float(learning_rate),
            logging_steps=1,
            save_strategy="no",
            report_to=[],
            fp16=torch.cuda.is_available(),
            use_cpu=not torch.cuda.is_available(),
            optim="adamw_torch",
            remove_unused_columns=False,
        )

        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=tokenized,
            data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
            callbacks=[LossCallback()],
        )

        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "training",
            "Trainer is running. Loss metrics will appear as steps complete.",
            examples_used=len(texts),
            max_seq_length=max_seq_length,
            device="cuda" if torch.cuda.is_available() else "cpu",
            lora={
                "r": lora_config.r,
                "alpha": lora_config.lora_alpha,
                "dropout": lora_config.lora_dropout,
                "target_modules": _target_modules_for(hf_model_name),
            },
        )
        trainer.train()
        model.save_pretrained(adapter_dir)
        tokenizer.save_pretrained(adapter_dir)

        manifest = {
            "job_id": job_id,
            "dataset_id": dataset_id,
            "dataset_path": resolved_path,
            "base_model": base_model,
            "hf_model": hf_model_name,
            "adapter_path": adapter_dir,
            "training_steps": total_steps,
            "learning_rate": learning_rate,
            "examples_used": len(texts),
            "max_seq_length": max_seq_length,
            "lora": {
                "r": lora_config.r,
                "alpha": lora_config.lora_alpha,
                "dropout": lora_config.lora_dropout,
                "target_modules": _target_modules_for(hf_model_name),
            },
            "device": "cuda" if torch.cuda.is_available() else "cpu",
            "created_at": datetime.utcnow().isoformat(),
            "status": "completed",
        }

        _write_manifest(manifest_path, manifest)

        _register_model(job_id, base_model, adapter_dir)
        _set_job_status(job_id, "completed", losses)
    except Exception as e:
        _stage_manifest(
            manifest_path,
            job_id,
            dataset_id,
            resolved_path,
            base_model,
            hf_model_name,
            "failed",
            "Training failed.",
            error=str(e),
            created_at=datetime.utcnow().isoformat(),
        )
        _set_job_status(job_id, "failed", losses)
        raise
