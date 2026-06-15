"use client";

import { Zap } from "lucide-react";
import { quickPrompts } from "@/lib/mockData";

interface WelcomeScreenProps {
  onPromptSelect: (prompt: string) => void;
}

export default function WelcomeScreen({ onPromptSelect }: WelcomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 animate-fade-in">
      {/* Hero Icon */}
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-forge-lg">
          <Zap size={28} className="text-white" fill="white" />
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
        </div>
        {/* Glow ring */}
        <div className="absolute inset-0 rounded-2xl blur-xl bg-sky-500/20 -z-10 scale-150" />
      </div>

      {/* Heading */}
      <h1
        className="text-3xl font-bold text-center text-white mb-3 leading-tight"
        style={{ fontFamily: "var(--font-display, 'Syne', sans-serif)" }}
      >
        What would you like to build today?
      </h1>
      <p className="text-[#6b7080] text-sm text-center max-w-md leading-relaxed mb-10">
        Upload your dataset, fine-tune{" "}
        <span className="text-sky-400 font-medium">Gemma 2B</span> with LoRA
        adapters, and test your custom model — all without writing a single
        line of code.
      </p>

      {/* Quick action cards */}
      <div className="grid grid-cols-2 gap-3 w-full max-w-xl">
        {quickPrompts.map((item, i) => (
          <button
            key={i}
            onClick={() => onPromptSelect(item.prompt)}
            className="group text-left p-4 rounded-xl
                       bg-[#161920] border border-white/[0.07]
                       hover:border-sky-500/30 hover:bg-[#1a1d2a]
                       transition-all duration-200
                       hover:shadow-[0_0_0_1px_rgba(14,165,233,0.15),0_4px_20px_rgba(14,165,233,0.06)]"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="text-xl mb-2">{item.icon}</div>
            <div className="text-sm font-semibold text-[#c8cdd8] group-hover:text-white transition-colors mb-1">
              {item.title}
            </div>
            <div className="text-xs text-[#555a6e] leading-relaxed">
              {item.description}
            </div>
          </button>
        ))}
      </div>

      {/* Hint */}
      <p className="mt-8 text-xs text-[#3d4155] text-center">
        Type a message or click a card to get started
      </p>
    </div>
  );
}
