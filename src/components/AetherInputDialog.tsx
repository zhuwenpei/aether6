import { useEffect, useRef, useState, type FormEvent, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface AetherInputDialogProps {
  open: boolean;
  title: string;
  description?: string;
  initialValue: string;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  confirmLabel?: string;
  cancelLabel?: string;
  onClose: () => void;
  /** Return an error message to keep the dialog open; return void on success. */
  onSubmit: (value: string) => string | void;
}

export default function AetherInputDialog({
  open,
  title,
  description,
  initialValue,
  placeholder,
  inputMode = "text",
  confirmLabel = "应用",
  cancelLabel = "取消",
  onClose,
  onSubmit
}: AetherInputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setError("");
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const message = onSubmit(value);
    if (typeof message === "string" && message) {
      setError(message);
      return;
    }
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-[#02060d]/78 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[min(420px,calc(100vw-24px))] rounded-2xl border border-slate-700/70 bg-[#08121f] p-4 text-white shadow-2xl sm:p-5"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-sky-200">{title}</h3>
            {description && <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:text-white" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => { setValue(event.target.value); if (error) setError(""); }}
          inputMode={inputMode}
          placeholder={placeholder}
          className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950/85 px-3 py-2.5 font-mono text-sm text-sky-100 outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/45"
        />
        {error && <div className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-200">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">{cancelLabel}</button>
          <button type="submit" className="rounded-lg border border-sky-500/60 bg-sky-500/15 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-500/25">{confirmLabel}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}
