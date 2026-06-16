"use client";

import { useState } from "react";
import { uploadRagDocument, queryRag } from "@/lib/api";

export default function RAGPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const uploadPDF = async () => {
    if (!file) {
      setMessage("Please select a PDF first.");
      return;
    }

    setLoading(true);
    setMessage("");

    const data = await uploadRagDocument(file);

    if (data.status === "success") {
      setMessage(`PDF uploaded successfully: ${data.filename}`);
    } else {
      setMessage(data.message || "PDF upload failed.");
    }

    setLoading(false);
  };

  const askQuestion = async () => {
    if (!question.trim()) {
      setMessage("Please enter a question.");
      return;
    }

    setLoading(true);
    setAnswer("");
    setSources([]);
    setMessage("");

    const data = await queryRag(question);

    setAnswer(data.answer || "No answer returned.");
    setSources(data.sources || []);

    setLoading(false);
  };

  return (
    <div className="h-full overflow-y-auto space-y-6 p-6 text-white">
      <div>
        <h1 className="text-2xl font-bold">📄 RAG Assistant</h1>
        <p className="text-gray-400">
          Upload a PDF and ask questions from your document.
        </p>
      </div>

      {message && (
        <div className="rounded border border-sky-500/20 bg-sky-500/10 p-3 text-sm text-sky-300">
          {message}
        </div>
      )}

      <div className="space-y-3">
        <input
          type="file"
          accept=".pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="text-sm text-gray-300"
        />

        <button
          onClick={uploadPDF}
          className="rounded bg-blue-600 px-4 py-2 text-white"
        >
          {loading ? "Processing..." : "Upload PDF"}
        </button>
      </div>

      <div className="space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask something from your PDF..."
          className="w-full rounded border p-3 text-black placeholder:text-gray-500"
          rows={4}
        />

        <button
          onClick={askQuestion}
          className="rounded bg-green-600 px-4 py-2 text-white"
        >
          {loading ? "Thinking..." : "Ask Question"}
        </button>
      </div>

      {answer && (
        <div className="rounded border bg-gray-50 p-4 text-black">
          <h2 className="font-bold">Answer</h2>
          <p className="mt-2 whitespace-pre-wrap">{answer}</p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="rounded border bg-white p-4 text-black">
          <h2 className="font-bold">Retrieved Sources</h2>

          <div className="mt-3 space-y-3">
            {sources.map((source, index) => (
              <div key={index} className="rounded border bg-gray-50 p-3">
                <p className="text-sm font-semibold">
                  Chunk {source.rank} · Score {source.score?.toFixed?.(3)}
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  {source.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}