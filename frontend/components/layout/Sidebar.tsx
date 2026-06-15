"use client";

import {
  MessageSquare,
  Database,
  Cpu,
  Layers,
  Settings,
  Plus,
  Zap,
  ChevronRight,
  User,
  Rocket,
} from "lucide-react";
import { cn, truncate, formatDate } from "@/lib/utils";
import type { NavItem, ChatSession } from "@/types";

interface SidebarProps {
  activeNav: NavItem;
  onNavChange: (nav: NavItem) => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSessionSelect: (id: string) => void;
  onNewChat: () => void;
}

const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
  { id: "chat", label: "Chat Studio", icon: <MessageSquare size={16} /> },
  { id: "datasets", label: "Dataset Upload", icon: <Database size={16} /> },
  { id: "training", label: "Training Jobs", icon: <Cpu size={16} /> },
  { id: "models", label: "Models", icon: <Layers size={16} /> },
  { id: "pipeline", label: "Pipeline", icon: <Rocket size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

export default function Sidebar({
  activeNav,
  onNavChange,
  sessions,
  activeSessionId,
  onSessionSelect,
  onNewChat,
}: SidebarProps) {
  return (
    <aside className="w-64 flex flex-col h-full bg-[#111318] border-r border-white/[0.06] shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-forge shrink-0">
            <Zap size={14} className="text-white" fill="white" />
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-white/20 to-transparent" />
          </div>
          <div>
            <div
              className="text-sm font-bold text-white leading-none"
              style={{ fontFamily: "var(--font-display, 'Syne', sans-serif)" }}
            >
              ModelForge
            </div>
            <div className="text-[10px] text-[#555a6e] font-medium tracking-wider uppercase mt-0.5">
              Chat Studio
            </div>
          </div>
        </div>
      </div>

      {/* New Chat */}
      <div className="px-3 pt-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg
                     bg-sky-500/10 hover:bg-sky-500/15 active:bg-sky-500/08
                     border border-sky-500/20 hover:border-sky-500/30
                     text-sky-400 hover:text-sky-300
                     text-sm font-medium transition-all duration-150 group"
        >
          <div className="flex items-center gap-2">
            <Plus size={15} />
            <span>New Chat</span>
          </div>
          <ChevronRight
            size={14}
            className="opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all duration-150"
          />
        </button>
      </div>

      {/* Navigation */}
      <div className="px-3 pt-4">
        <div className="text-[10px] font-semibold text-[#3d4155] uppercase tracking-widest px-2 mb-1.5">
          Navigation
        </div>
        <nav className="space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavChange(item.id)}
              className={cn(
                "w-full text-left",
                activeNav === item.id ? "nav-item-active" : "nav-item"
              )}
            >
              <span
                className={cn(
                  "transition-colors",
                  activeNav === item.id ? "text-sky-400" : "text-[#555a6e]"
                )}
              >
                {item.icon}
              </span>
              {item.label}
              {activeNav === item.id && (
                <div className="ml-auto w-1 h-1 rounded-full bg-sky-400" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Recent Chats */}
      {sessions.length > 0 && (
        <div className="px-3 mt-4 flex-1 overflow-hidden">
          <div className="text-[10px] font-semibold text-[#3d4155] uppercase tracking-widest px-2 mb-1.5">
            Recent Projects
          </div>
          <div className="space-y-0.5 overflow-y-auto max-h-[220px]">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  onSessionSelect(session.id);
                  onNavChange("chat");
                }}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-lg group transition-all duration-150",
                  activeSessionId === session.id && activeNav === "chat"
                    ? "bg-white/[0.07] text-[#e2e5ee] border border-white/[0.07]"
                    : "hover:bg-white/[0.04] text-[#6b7080] hover:text-[#c8cdd8]"
                )}
              >
                <div className="flex items-start gap-2">
                  <MessageSquare
                    size={13}
                    className="mt-0.5 shrink-0 opacity-50"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate leading-snug">
                      {truncate(session.title, 32)}
                    </div>
                    <div className="text-[10px] text-[#3d4155] mt-0.5">
                      {formatDate(session.updatedAt)}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* User Profile */}
      <div className="px-3 py-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.04] transition-all duration-150 cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shrink-0 shadow-sm">
            <User size={14} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-[#c8cdd8] truncate">
              FYP Student
            </div>
            <div className="text-[10px] text-[#3d4155] truncate">
              student@university.edu
            </div>
          </div>
          <Settings
            size={13}
            className="text-[#3d4155] group-hover:text-[#6b7080] transition-colors shrink-0"
          />
        </div>
      </div>
    </aside>
  );
}
