import os
import json
import uuid
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

GENERATED_DIR = "generated_datasets"
os.makedirs(GENERATED_DIR, exist_ok=True)


def generate_dataset_from_pdf(file_path: str):
    loader = PyPDFLoader(file_path)
    documents = loader.load()

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=700,
        chunk_overlap=100
    )

    chunks = splitter.split_documents(documents)

    dataset_id = f"generated-{uuid.uuid4().hex[:8]}"
    output_path = os.path.join(GENERATED_DIR, f"{dataset_id}.jsonl")

    rows = []

    for i, chunk in enumerate(chunks[:20]):
        text = chunk.page_content.strip()

        if len(text) < 100:
            continue

        row = {
            "instruction": f"Explain the main idea of this document section {i + 1}.",
            "input": text,
            "response": text[:500]
        }

        rows.append(row)

    with open(output_path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    return {
        "dataset_id": dataset_id,
        "path": output_path,
        "rows": len(rows)
    }