"use client";

import { useRef, useState, KeyboardEvent } from "react";
import {
  Send,
  Upload,
  Cpu,
  ChevronDown,
  Zap,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelCard, ModelOption } from "@/types";

interface ChatInputProps {
  onSend: (message: string) => void;
  onOpenUpload: () => void;
  onOpenTraining: () => void;
  model: ModelOption;
  onModelChange: (model: ModelOption) => void;
  models?: ModelCard[];
  disabled?: boolean;
}

export default function ChatInput({
  onSend,
  onOpenUpload,
  onOpenTraining,
  model,
  onModelChange,
  models = [],
  disabled,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const modelOptions = [
    {
      id: "base-gemma",
      label: "Base Qwen2.5-1.5B-Instruct",
      icon: <Layers size={13} />,
      desc: "Qwen2.5 1.5B Instruct",
      isFineTuned: false,
    },
    {
      id: "finetuned-model",
      label: "Qwen Math Fine-Tuned",
      icon: <Zap size={13} />,
      desc: "Ollama: modelforge-qwen-math",
      isFineTuned: true,
    },
    ...models
      .filter((item) => item.type === "finetuned" && item.deployed && item.runtimeModel)
      .map((item) => ({
        id: item.id,
        label: item.name,
        icon: <Zap size={13} />,
        desc: item.runtimeModel || item.baseModel || "Deployed custom model",
        isFineTuned: true,
      })),
  ];

  const current = modelOptions.find((item) => item.id === model) || modelOptions[0];

  return (
    <div className="px-4 pb-4 pt-2 border-t border-white/[0.06] bg-[#0c0e14]">
      {/* Toolbar row */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <button
          onClick={onOpenUpload}
          className="forge-btn-ghost text-xs py-1.5 px-2.5"
        >
          <Upload size={13} />
          Upload Dataset
        </button>
        <button
          onClick={onOpenTraining}
          className="forge-btn-ghost text-xs py-1.5 px-2.5"
        >
          <Cpu size={13} />
          Train Model
        </button>

        <div className="flex-1" />

        {/* Model selector */}
        <div className="relative">
          <button
            onClick={() => setModelOpen(!modelOpen)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium",
              "bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08]",
              "text-[#8b90a0] hover:text-[#c8cdd8] transition-all duration-150"
            )}
          >
            <span
              className={
                current.isFineTuned ? "text-sky-400" : "text-[#6b7080]"
              }
            >
              {current.icon}
            </span>
            <span>{current.label}</span>
            <ChevronDown
              size={12}
              className={cn(
                "transition-transform duration-150",
                modelOpen && "rotate-180"
              )}
            />
          </button>

          {modelOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-56 forge-card py-1 z-50 animate-slide-up">
              {modelOptions.map(
                (option) => {
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        onModelChange(option.id);
                        setModelOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-start gap-3 px-3 py-2.5 hover:bg-white/[0.05] transition-colors text-left",
                        model === option.id && "bg-white/[0.04]"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5",
                          option.isFineTuned
                            ? "text-sky-400"
                            : "text-[#6b7080]"
                        )}
                      >
                        {option.icon}
                      </span>
                      <div>
                        <div className="text-xs font-medium text-[#c8cdd8]">
                          {option.label}
                        </div>
                        <div className="text-[10px] text-[#555a6e]">
                          {option.desc}
                        </div>
                      </div>
                      {model === option.id && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-400 mt-1" />
                      )}
                    </button>
                  );
                }
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input row */}
      <div className="relative flex items-end gap-2 p-3 rounded-xl bg-[#161920] border border-white/[0.09] hover:border-white/[0.14] focus-within:border-sky-500/40 focus-within:ring-1 focus-within:ring-sky-500/15 transition-all duration-150">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Message ModelForge AI… (Shift+Enter for newline)"
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-sm text-[#e2e5ee] placeholder:text-[#3d4155] leading-relaxed py-0.5 max-h-[180px] overflow-y-auto disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className={cn(
            "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150",
            value.trim() && !disabled
              ? "bg-sky-500 hover:bg-sky-400 text-white shadow-forge cursor-pointer"
              : "bg-white/[0.04] text-[#3d4155] cursor-not-allowed"
          )}
        >
          <Send size={14} />
        </button>
      </div>

      <p className="text-center text-[10px] text-[#2d3044] mt-2">
        ModelForge may produce errors. Verify outputs before deploying to
        production.
      </p>
    </div>
  );
}
