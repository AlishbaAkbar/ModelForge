"use client";

import { useEffect, useState } from "react";
import { FileText, RefreshCw, Trash2, Upload, Search } from "lucide-react";
import {
  deleteRagDocument,
  fetchRagJob,
  fetchRagDocuments,
  queryRag,
  rebuildRagIndex,
  uploadRagDocument,
} from "@/lib/api";

export default function RAGPanel() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(4);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<any[]>([]);
  const [citations, setCitations] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [activeJobId, setActiveJobId] = useState("");
  const [activeJob, setActiveJob] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const formatScore = (score: unknown) => {
    return typeof score === "number" ? score.toFixed(3) : "N/A";
  };

  const loadDocuments = async () => {
    try {
      const data = await fetchRagDocuments();
      setDocuments(data.documents || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Documents could not be loaded.");
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  useEffect(() => {
    if (!activeJobId) return;

    const poll = async () => {
      try {
        const data = await fetchRagJob(activeJobId);
        setActiveJob(data.job);
        await loadDocuments();
        if (["completed", "failed"].includes(data.job.status)) {
          setActiveJobId("");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "RAG job status failed.");
        setActiveJobId("");
      }
    };

    poll();
    const timer = window.setInterval(poll, 1500);
    return () => window.clearInterval(timer);
  }, [activeJobId]);

  const uploadPDF = async () => {
    if (!file) {
      setMessage("Please select a PDF first.");
      return;
    }

    setLoading(true);
    setMessage("");
    setError("");

    try {
      const data = await uploadRagDocument(file);
      setMessage(data.message || `Uploaded ${data.filename}.`);
      if (data.jobId) setActiveJobId(data.jobId);
      setFile(null);
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF upload failed.");
    } finally {
      setLoading(false);
    }
  };

  const removeDocument = async (documentId: string) => {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const data = await deleteRagDocument(documentId);
      setMessage(data.message || "Document deleted.");
      if (data.jobId) setActiveJobId(data.jobId);
      if (selectedDocumentId === documentId) setSelectedDocumentId("");
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Document delete failed.");
    } finally {
      setLoading(false);
    }
  };

  const rebuild = async () => {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const data = await rebuildRagIndex(selectedDocumentId || undefined);
      setMessage(data.message || "Rebuild started.");
      if (data.jobId) setActiveJobId(data.jobId);
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Index rebuild failed.");
    } finally {
      setLoading(false);
    }
  };

  const askQuestion = async () => {
    if (!question.trim()) {
      setMessage("Please enter a question.");
      return;
    }

    setLoading(true);
    setAnswer("");
    setSources([]);
    setCitations([]);
    setMetrics(null);
    setMessage("");
    setError("");

    try {
      const data = await queryRag(question, topK, selectedDocumentId || undefined);
      setAnswer(data.answer || "No answer returned.");
      setSources(data.sources || []);
      setCitations(data.citations || []);
      setMetrics(data.metrics || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "RAG query failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 text-white">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-sky-400">
            Document RAG
          </div>
          <h1 className="text-3xl font-bold">Knowledge Base</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#8b91a3]">
            Upload PDFs, persist indexed chunks, query one document or all documents, and inspect cited sources.
          </p>
        </div>
        <button onClick={rebuild} disabled={loading} className="forge-btn-secondary w-fit">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Rebuild Index
        </button>
      </div>

      {(message || error) && (
        <div className={`mb-6 rounded-xl border p-4 text-sm ${error ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"}`}>
          {error || message}
        </div>
      )}

      {activeJob && (
        <div className="mb-6 rounded-xl border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-sky-200">
          <div className="mb-2 flex items-center justify-between">
            <span>{activeJob.message}</span>
            <span>{activeJob.progress ?? 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/30">
            <div
              className="h-full rounded-full bg-sky-400 transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(100, activeJob.progress ?? 0))}%` }}
            />
          </div>
          {activeJob.currentDocument && (
            <div className="mt-2 text-xs text-sky-300">{activeJob.currentDocument}</div>
          )}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Upload size={16} className="text-sky-400" />
          Upload Document
        </div>
        <div className="flex flex-col gap-3 lg:flex-row">
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block flex-1 text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500/20 file:px-3 file:py-2 file:text-sky-300"
          />
          <button onClick={uploadPDF} disabled={loading} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50">
            {loading ? "Processing..." : "Upload and Index"}
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <FileText size={16} className="text-violet-400" />
          Uploaded Documents
        </div>
        {documents.length === 0 ? (
          <div className="text-sm text-[#6b7080]">No documents uploaded yet.</div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-black/20 p-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{doc.filename}</div>
                  <div className="mt-1 text-xs text-[#8b91a3]">
                    {doc.id} | {doc.chunkCount} chunks | {doc.embeddingStatus}
                  </div>
                </div>
                <button
                  onClick={() => removeDocument(doc.id)}
                  disabled={loading}
                  className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                >
                  <Trash2 size={12} className="inline" /> Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Search size={16} className="text-emerald-400" />
          Ask Documents
        </div>
        <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_120px]">
          <select
            value={selectedDocumentId}
            onChange={(e) => setSelectedDocumentId(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/40"
          >
            <option value="">All documents</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.filename}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2">
            <span className="text-xs font-semibold uppercase text-[#8b91a3]">Top-K</span>
            <input
              type="number"
              min={1}
              max={10}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value) || 4)}
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
            />
          </label>
        </div>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask something from your indexed documents..."
          className="mb-3 w-full rounded-lg border border-white/[0.08] bg-black/30 p-3 text-sm text-white placeholder:text-[#555a6e] outline-none focus:border-sky-500/40"
          rows={4}
        />
        <button onClick={askQuestion} disabled={loading} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          {loading ? "Thinking..." : "Ask Question"}
        </button>
      </div>

      {answer && (
        <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
          <h2 className="mb-2 text-sm font-semibold text-white">Answer</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#d6d8e4]">{answer}</p>
          {metrics && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#8b91a3]">
              <span>Retrieved: {metrics.retrieved_chunks_count}</span>
              <span>Relevance: {metrics.retrieval_relevance}</span>
              <span>Context precision: {metrics.context_precision}</span>
              <span>Quality: {metrics.answer_quality}</span>
            </div>
          )}
        </div>
      )}

      {citations.length > 0 && (
        <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
          <h2 className="mb-3 text-sm font-semibold text-white">Citations</h2>
          <div className="space-y-2">
            {citations.map((citation, index) => (
              <div key={`${citation.chunk}-${index}`} className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs text-[#c8cdd8]">
                Source {citation.rank}: {citation.source} | page {citation.page || "N/A"} | {citation.chunk}
              </div>
            ))}
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
                Retrieval Evidence
              </div>
              <h2 className="mt-1 text-lg font-semibold text-white">Retrieved Top-K Chunks</h2>
            </div>
            <div className="text-xs text-[#8b91a3]">
              requested {topK} | retrieved {sources.length}
            </div>
          </div>
          <div className="space-y-3">
            {sources.map((source) => (
              <div key={source.chunkId || source.rank} className="rounded-lg border border-white/[0.06] bg-black/25 p-4">
                <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-emerald-400/15 px-2 py-1 text-xs font-semibold text-emerald-300">
                      Rank #{source.rank}
                    </span>
                    <span className="rounded-md bg-sky-400/10 px-2 py-1 text-xs font-semibold text-sky-300">
                      Score {formatScore(source.score)}
                    </span>
                    <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-[#c8cdd8]">
                      Page {source.pageNumber || "N/A"}
                    </span>
                  </div>
                  <div className="text-xs text-[#8b91a3]">{source.chunkId}</div>
                </div>
                <div className="mb-2 truncate text-sm font-semibold text-white">
                  {source.documentName || "Uploaded document"}
                </div>
                <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/[0.04] bg-black/20 p-3 text-sm leading-relaxed text-[#d6d8e4]">
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
