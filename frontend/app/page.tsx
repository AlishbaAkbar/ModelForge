"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/layout/Sidebar";
import ChatMessage, { TypingIndicator } from "@/components/chat/ChatMessage";
import WelcomeScreen from "@/components/chat/WelcomeScreen";
import ChatInput from "@/components/chat/ChatInput";
import UploadModal from "@/components/modals/UploadModal";
import TrainingModal from "@/components/modals/TrainingModal";
import DatasetsPanel from "@/components/panels/DatasetsPanel";
import TrainingPanel from "@/components/panels/TrainingPanel";
import ModelsPanel from "@/components/panels/ModelsPanel";
import SettingsPanel from "@/components/panels/SettingsPanel";
import RagPanel from "@/components/panels/RagPanel";
import EvaluationPanel from "@/components/panels/EvaluationPanel";
import DeploymentPanel from "@/components/panels/DeploymentPanel";

import {
  fetchDatasets,
  fetchModels,
  fetchTrainingJobs,
  sendChatMessage,
} from "@/lib/api";
import { generateId } from "@/lib/utils";

import type {
  NavItem,
  ChatSession,
  ChatMessage as ChatMessageType,
  Dataset,
  TrainingJob,
  ModelCard,
  ModelOption,
} from "@/types";
import PipelinePanel from "@/components/panels/PipelinePanel";

export default function Page() {
  const [activeNav, setActiveNav] = useState<NavItem>("chat");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelOption>("base-gemma");

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [trainingJobs, setTrainingJobs] = useState<TrainingJob[]>([]);
  const [models, setModels] = useState<ModelCard[]>([]);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages, isTyping]);

  useEffect(() => {
    const loadWorkspaceState = async () => {
      const [datasetResult, jobResult, modelResult] = await Promise.allSettled([
        fetchDatasets(),
        fetchTrainingJobs(),
        fetchModels(),
      ]);

      if (datasetResult.status === "fulfilled") {
        setDatasets(datasetResult.value);
      }

      if (jobResult.status === "fulfilled") {
        setTrainingJobs(jobResult.value);
      }

      if (modelResult.status === "fulfilled") {
        setModels(modelResult.value);
      }
    };

    loadWorkspaceState();
  }, []);

  const handleNewChat = () => {
    setActiveSessionId(null);
    setActiveNav("chat");
  };

  const handleSendMessage = async (content: string) => {
    let session = activeSession;

    // Create a new session if none is active
    if (!session) {
      const newSession: ChatSession = {
        id: `session-${generateId()}`,
        title: content.slice(0, 48) + (content.length > 48 ? "…" : ""),
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        model: selectedModel,
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      session = newSession;
    }

    // Add user message
    const userMessage: ChatMessageType = {
      id: `msg-${generateId()}`,
      role: "user",
      content,
      timestamp: new Date(),
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === session!.id
          ? {
              ...s,
              messages: [...s.messages, userMessage],
              updatedAt: new Date(),
            }
          : s
      )
    );

    // Show typing indicator
    setIsTyping(true);

    const response = await sendChatMessage(content, selectedModel, session.id);

    setIsTyping(false);

    // Add AI response
    setSessions((prev) =>
      prev.map((s) =>
        s.id === session!.id
          ? {
              ...s,
              messages: [...s.messages, response],
              updatedAt: new Date(),
            }
          : s
      )
    );
  };

  const handleDatasetUploaded = (dataset: Dataset) => {
    setDatasets((prev) => [dataset, ...prev]);
  };

  const handleDatasetDeleted = (id: string) => {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
  };

  const handleJobStarted = (job: TrainingJob) => {
    setTrainingJobs((prev) => [job, ...prev]);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0c0e14]">
      {/* Sidebar */}
      <Sidebar
        activeNav={activeNav}
        onNavChange={setActiveNav}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionSelect={setActiveSessionId}
        onNewChat={handleNewChat}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Mesh background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(at 30% 10%, rgba(14,165,233,0.06) 0px, transparent 55%), radial-gradient(at 80% 80%, rgba(99,102,241,0.04) 0px, transparent 55%)",
          }}
        />

        {/* Chat Studio */}
        {activeNav === "chat" && (
          <div className="relative flex flex-col flex-1 min-h-0">
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto">
              {!activeSession || activeSession.messages.length === 0 ? (
                <WelcomeScreen
                  onPromptSelect={(prompt) => {
                    handleSendMessage(prompt);
                    setActiveNav("chat");
                  }}
                />
              ) : (
                <div className="py-4">
                  {/* Session header */}
                  <div className="px-6 py-2 mb-2">
                    <div className="flex items-center gap-2 text-xs text-[#3d4155]">
                      <span className="font-medium text-[#555a6e]">
                        {activeSession.title}
                      </span>
                      <span>·</span>
                      <span>
                        {activeSession.messages.length} message
                        {activeSession.messages.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  {activeSession.messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}

                  {isTyping && (
                    <TypingIndicator
                      model={
                        selectedModel === "finetuned-model"
                          ? "ModelForge-Qwen-Math-LoRA"
                          : "Base Qwen2.5-1.5B-Instruct 2B"
                      }
                    />
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input */}
            <ChatInput
              onSend={handleSendMessage}
              onOpenUpload={() => setShowUploadModal(true)}
              onOpenTraining={() => setShowTrainingModal(true)}
              model={selectedModel}
              onModelChange={setSelectedModel}
              disabled={isTyping}
            />
          </div>
        )}

        {/* Datasets */}
        {activeNav === "datasets" && (
          <DatasetsPanel
            datasets={datasets}
            onUpload={() => setShowUploadModal(true)}
            onDelete={handleDatasetDeleted}
          />
        )}

        {/* Training Jobs */}
        {activeNav === "training" && (
          <TrainingPanel
            jobs={trainingJobs}
            onNewJob={() => setShowTrainingModal(true)}
          />
        )}

        {/* Models */}
        {activeNav === "models" && <ModelsPanel models={models} />}

        {/* Pipeline */}
        {activeNav === "pipeline" && <PipelinePanel />}
        {/* RAG */}
        {activeNav === "rag" && (
          <div className="relative flex-1 overflow-y-auto">
            <RagPanel />
          </div>
        )}
        {/* Evaluation */}
        {activeNav === "evaluation" && <EvaluationPanel />}
        {/* Deployment */}
        {activeNav === "deployment" && <DeploymentPanel />}
        {/* Settings */}
        {activeNav === "settings" && <SettingsPanel />}
      </main>

      {/* Modals */}
      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleDatasetUploaded}
        />
      )}

      {showTrainingModal && (
        <TrainingModal
          datasets={datasets}
          onClose={() => setShowTrainingModal(false)}
          onJobStarted={handleJobStarted}
        />
      )}
    </div>
  );
}
