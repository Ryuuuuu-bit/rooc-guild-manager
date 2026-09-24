"use client";

// One app-wide replacement for the browser's confirm() / alert() / prompt():
// a styled dialog (works properly on phones, can't be accidentally
// suppressed by "prevent this page from creating dialogs") and a toast with
// an optional action (e.g. Undo). Call sites use the plain async functions
// below — `if (!(await uiConfirm({...}))) return;` — so a handler only needs
// to become async; nothing else about its logic changes.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button — for deletes, kicks, clears. */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

export interface ToastOptions {
  tone?: "default" | "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
  /** ms before it hides (default 3.5s, 7s with an action). */
  duration?: number;
}

type Dialog =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

interface Api {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  toast: (text: string, opts?: ToastOptions) => void;
}

// Set by the mounted provider. Before it mounts (or outside the app shell)
// the functions fall back to the native browser dialogs, so nothing breaks.
let api: Api | null = null;

const plain = (n: ReactNode) => (typeof n === "string" ? n : "");

export function uiConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (api) return api.confirm(opts);
  return Promise.resolve(window.confirm([opts.title, plain(opts.message)].filter(Boolean).join("\n\n")));
}

export function uiPrompt(opts: PromptOptions): Promise<string | null> {
  if (api) return api.prompt(opts);
  return Promise.resolve(window.prompt(opts.title, opts.defaultValue ?? ""));
}

export function uiToast(text: string, opts?: ToastOptions): void {
  if (api) api.toast(text, opts);
  else if (opts?.tone === "error") window.alert(text);
}

/** Error/notice that used to be an alert() — shown as a red toast. */
export function uiAlert(text: string): void {
  uiToast(text, { tone: "error", duration: 5000 });
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [value, setValue] = useState("");
  const [toast, setToast] = useState<({ text: string } & ToastOptions) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const showToast = useCallback((text: string, opts?: ToastOptions) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, ...opts });
    timer.current = setTimeout(() => setToast(null), opts?.duration ?? (opts?.onAction ? 7000 : 3500));
  }, []);

  useEffect(() => {
    api = {
      confirm: (opts) => new Promise<boolean>((resolve) => setDialog({ kind: "confirm", opts, resolve })),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          setValue(opts.defaultValue ?? "");
          setDialog({ kind: "prompt", opts, resolve });
        }),
      toast: showToast,
    };
    return () => {
      api = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [showToast]);

  // Focus the primary control when a dialog opens (DOM only — no state).
  useEffect(() => {
    if (!dialog) return;
    const t = setTimeout(() => (dialog.kind === "prompt" ? input.current?.select() : confirmBtn.current?.focus()), 20);
    return () => clearTimeout(t);
  }, [dialog]);

  function close(ok: boolean) {
    if (!dialog) return;
    if (dialog.kind === "confirm") dialog.resolve(ok);
    else dialog.resolve(ok ? value : null);
    setDialog(null);
  }

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (dialog.kind === "confirm") dialog.resolve(false);
        else dialog.resolve(null);
        setDialog(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog]);

  const opts = dialog?.opts;
  const danger = dialog?.kind === "confirm" && dialog.opts.danger;

  return (
    <>
      {children}
      {dialog && opts && (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-[2px]"
          onMouseDown={(e) => e.target === e.currentTarget && close(false)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label={opts.title}
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
            className="w-full max-w-[420px] rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl shadow-black/70"
          >
            <h2 className="text-[15px] font-semibold text-zinc-50">{opts.title}</h2>
            {opts.message && <div className="mt-1 whitespace-pre-line break-words text-[13px] text-zinc-400">{opts.message}</div>}
            {dialog.kind === "prompt" && (
              <input
                ref={input}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={dialog.opts.placeholder}
                className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => close(false)} className="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800">
                {(dialog.kind === "confirm" && dialog.opts.cancelLabel) || "Cancel"}
              </button>
              <button
                ref={confirmBtn}
                type="submit"
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white transition ${
                  danger ? "bg-rose-600 hover:bg-rose-500" : "bg-amber-600 hover:bg-amber-500"
                }`}
              >
                {opts.confirmLabel ?? (dialog.kind === "prompt" ? "Save" : "Confirm")}
              </button>
            </div>
          </form>
        </div>
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[95] flex justify-center px-4 md:bottom-5">
          <div
            role="status"
            className={`pointer-events-auto flex max-w-full items-center gap-3 rounded-xl border px-3.5 py-2 text-[13px] shadow-xl shadow-black/50 ${
              toast.tone === "error"
                ? "border-rose-800/70 bg-rose-950 text-rose-100"
                : toast.tone === "success"
                  ? "border-emerald-800/60 bg-zinc-900 text-emerald-100"
                  : "border-zinc-700 bg-zinc-800 text-zinc-100"
            }`}
          >
            <span className="min-w-0 break-words">{toast.text}</span>
            {toast.onAction && (
              <button
                type="button"
                onClick={() => {
                  const fn = toast.onAction;
                  setToast(null);
                  fn?.();
                }}
                className="shrink-0 font-semibold text-amber-300 hover:text-amber-200"
              >
                {toast.actionLabel ?? "Undo"}
              </button>
            )}
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="shrink-0 text-zinc-500 hover:text-zinc-300">
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
