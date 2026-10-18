import React, { useEffect } from "react";
import { X } from "lucide-react";
import Wizard from "./components/Wizard";
import "./cloudCompositorDark.css";

interface CloudCompositorModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLat: number;
  targetLon: number;
  initialDate?: string;
}

export default function CloudCompositorModal({ isOpen, onClose, targetLat, targetLon, initialDate }: CloudCompositorModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="cloud-compositor-dark cloud-compositor-overlay fixed inset-0 z-[12600] bg-[#030914]/96 backdrop-blur-md flex items-stretch justify-center sm:p-4">
      <div className="cloud-compositor-shell relative w-full max-w-xl h-[100dvh] sm:h-[min(94dvh,940px)] sm:my-auto sm:rounded-2xl overflow-hidden border border-slate-700/70 shadow-2xl bg-slate-950">
        <Wizard targetLat={targetLat} targetLon={targetLon} initialDate={initialDate} />
        <button
          type="button"
          onClick={onClose}
          className="cloud-compositor-close absolute top-[max(12px,env(safe-area-inset-top))] right-[max(12px,env(safe-area-inset-right))] z-[2500] w-10 h-10 rounded-xl border border-slate-600/70 bg-slate-950/88 backdrop-blur-md text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center transition active:scale-95"
          title="关闭卫星实景拼接"
          aria-label="关闭卫星实景拼接"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
