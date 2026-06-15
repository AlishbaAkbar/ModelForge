"use client";

import { User, Zap, Copy, Check } from "lucide-react";
import { useState } from "react";
import { cn, formatMarkdown } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/types";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        "group flex gap-4 px-6 py-4 animate-slide-up",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        {isUser ? (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-sm">
            <User size={14} className="text-white" />
          </div>
        ) : (
          <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-forge">
            <Zap size={13} className="text-white" fill="white" />
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-white/20 to-transparent" />
          </div>
        )}
      </div>

      {/* Content */}
      <div
        className={cn("flex flex-col gap-1 max-w-[80%]", isUser && "items-end")}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center gap-2 text-xs text-[#555a6e]",
            isUser && "flex-row-reverse"
          )}
        >
          <span className="font-medium">
            {isUser ? "You" : message.model || "ModelForge AI"}
          </span>
          <span>
            {message.timestamp.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        {/* Bubble */}
        <div
          className={cn(
            "relative px-4 py-3 rounded-2xl text-sm leading-relaxed",
            isUser
              ? "bg-sky-600 text-white rounded-tr-sm"
              : "bg-[#1a1d27] border border-white/[0.07] text-[#d4d8e4] rounded-tl-sm"
          )}
        >
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <div
              className="message-content"
              dangerouslySetInnerHTML={{
                __html: formatMarkdown(message.content),
              }}
            />
          )}
        </div>

        {/* Copy button (AI messages only) */}
        {!isUser && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md
                       text-[10px] text-[#3d4155] hover:text-[#8b90a0]
                       hover:bg-white/[0.04] transition-all duration-150
                       opacity-0 group-hover:opacity-100"
          >
            {copied ? (
              <>
                <Check size={11} className="text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                Copy
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// Typing indicator
export function TypingIndicator({ model }: { model: string }) {
  return (
    <div className="flex gap-4 px-6 py-4 animate-fade-in">
      <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-forge shrink-0">
        <Zap size={13} className="text-white" fill="white" />
        <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-white/20 to-transparent" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-xs text-[#555a6e] font-medium">
          {model || "ModelForge AI"}
        </div>
        <div className="flex items-center gap-1.5 px-4 py-3 rounded-2xl rounded-tl-sm bg-[#1a1d27] border border-white/[0.07]">
          <div className="flex items-center gap-1 text-sky-400">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      </div>
    </div>
  );
}
