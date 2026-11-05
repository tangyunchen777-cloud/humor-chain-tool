/* eslint-disable @next/next/no-img-element -- Private signed source images and local blob previews must not use an external image optimizer. */
"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Chain, Data, Run, Step } from "@/lib/studio";
import { getChainHistory } from "@/lib/studio-view";
import { signOut } from "@/app/auth/actions";

type DraftStep = Step & { key: string };
type IconName =
  | "plus"
  | "chain"
  | "image"
  | "play"
  | "check"
  | "chevron"
  | "up"
  | "down"
  | "close"
  | "copy"
  | "edit";
function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    chain: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
        <path d="M6.5 10v5a2 2 0 0 0 2 2H14" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 5-5 4 4 4-6 5 7" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    up: <path d="m6 10 6-6 6 6M12 4v16" />,
    down: <path d="m6 14 6 6 6-6M12 4v16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M15 8V4H4v11h4" />
      </>
    ),
    edit: <path d="m4 16-1 5 5-1L21 7l-4-4Z M14 6l4 4" />,
  };
  return (
    <svg
      aria-hidden="true"
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
const draftStep = (): DraftStep => ({
  key: crypto.randomUUID(),
  position: 1,
  name: "New step",
  instruction: "",
  input_mode: "previous",
});
async function api(op: string, payload: unknown, image?: File) {
  const body = new FormData();
  body.set("op", op);
  body.set("payload", JSON.stringify(payload));
  if (image) body.set("image", image);
  const response = await fetch("/api/studio", { method: "POST", body });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Your session expired. Reload and sign in again.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result.data;
}
const subscribeTheme = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("chain-theme-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("chain-theme-change", callback);
  };
};
export function Studio({
  initial,
  userName,
}: {
  initial: Data;
  userName: string;
}) {
  const initialChain = initial.chains.find((c) => c.id === initial.selected);
  const initialSteps = initial.steps
    .filter((s) => s.chain_id === initial.selected)
    .map((s) => ({ ...s, key: s.id! }));
  const [data, setData] = useState(initial),
    [id, setId] = useState<string | null>(initial.selected);
  const [name, setName] = useState(initialChain?.name ?? "Untitled chain");
  const [description, setDescription] = useState(
    initialChain?.description ?? "",
  );
  const [model, setModel] = useState(
    initialChain?.model_key ?? initial.models[0]?.model_key ?? "",
  );
  const [steps, setSteps] = useState<DraftStep[]>(initialSteps);
  const [version, setVersion] = useState<string | null>(
    initialChain?.updated_at ?? null,
  );
  const [expandedStep, setExpandedStep] = useState<string | null>(
    initialSteps[0]?.key ?? null,
  );
  const [dialog, setDialog] = useState<{
    message: string;
    resolve: (answer: boolean) => void;
  } | null>(null);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [archiveView, setArchiveView] = useState(!!initialChain?.deleted_at);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [input, setInput] = useState(""),
    [file, setFile] = useState<File>(),
    [preview, setPreview] = useState(""),
    [progress, setProgress] = useState("");
  const fileInput = useRef<HTMLInputElement>(null),
    nameInput = useRef<HTMLInputElement>(null);
  const chainHeader = useRef<HTMLElement>(null),
    resultsSection = useRef<HTMLElement>(null),
    confirmDialog = useRef<HTMLDialogElement>(null);
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => localStorage.getItem("chain-theme") || "system",
    () => "system",
  );
  const chain = data.chains.find((c) => c.id === id),
    archived = !!chain?.deleted_at,
    locked = archived || running || busy;
  const title = name.trim() || "Untitled chain";
  const { runs, viewed } = getChainHistory(data.runs, id, selectedRun);
  const runSteps = data.runSteps.filter((s) => s.run_id === viewed?.id),
    completeCount = runs.filter((r) => r.status === "succeeded").length;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (dialog) confirmDialog.current?.showModal();
  }, [dialog]);
  function ask(message: string) {
    return new Promise<boolean>((resolve) => setDialog({ message, resolve }));
  }
  function answer(value: boolean) {
    dialog?.resolve(value);
    setDialog(null);
  }
  function clearSource() {
    setInput("");
    setFile(undefined);
    setPreview("");
    setProgress("");
    if (fileInput.current) fileInput.current.value = "";
  }
  function hydrate(nextChain: Chain | undefined, all: Data) {
    setName(nextChain?.name ?? "Untitled chain");
    setDescription(nextChain?.description ?? "");
    setModel(nextChain?.model_key ?? all.models[0]?.model_key ?? "");
    setVersion(nextChain?.updated_at ?? null);
    const nextSteps = all.steps
      .filter((s) => s.chain_id === nextChain?.id)
      .map((s) => ({ ...s, key: s.id! }));
    setSteps(nextSteps);
    setExpandedStep(nextSteps[0]?.key ?? null);
    setDirty(false);
  }
  async function refresh(chainId = id) {
    const res = await fetch(
      "/api/studio" + (chainId ? "?chain=" + chainId : ""),
      { cache: "no-store" },
    );
    if (!res.ok)
      throw new Error("Workspace could not refresh. Reload the page.");
    const next: Data = await res.json();
    setData(next);
    return next;
  }
  async function choose(chainId: string) {
    if (busy || running || chainId === id) return;
    if (dirty && !(await ask("Discard your unsaved changes?"))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await refresh(chainId);
      setId(chainId);
      hydrate(
        next.chains.find((c) => c.id === chainId),
        next,
      );
      setSelectedRun(null);
      clearSource();
      chainHeader.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (busy || running) return;
    if (dirty && !(await ask("Discard your unsaved changes?"))) return;
    setId(null);
    hydrate(undefined, data);
    const first = {
      ...draftStep(),
      name: "Read the scene",
      input_mode: "original" as const,
    };
    setSteps([first]);
    setExpandedStep(first.key);
    setDirty(true);
    setArchiveView(false);
    setSelectedRun(null);
    setError("");
    setNotice("");
    clearSource();
    requestAnimationFrame(() => {
      chainHeader.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      nameInput.current?.focus({ preventScroll: true });
      nameInput.current?.select();
    });
  }
  function editStep(index: number, patch: Partial<Step>) {
    setSteps((s) =>
      s.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
    setDirty(true);
  }
  function move(index: number, direction: number) {
    setSteps((s) => {
      const copy = [...s];
      [copy[index], copy[index + direction]] = [
        copy[index + direction],
        copy[index],
      ];
      return copy;
    });
    setDirty(true);
  }
  function addStep() {
    const next = draftStep();
    setSteps([...steps, next]);
    setExpandedStep(next.key);
    setDirty(true);
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api("save", {
        cid: id,
        version,
        title: name,
        summary: description,
        model,
        steps: steps.map((s, i) => ({
          id: s.id ?? null,
          name: s.name,
          instruction: s.instruction,
          input_mode: s.input_mode,
          position: i + 1,
        })),
      });
      const next = await refresh(saved);
      setId(saved);
      hydrate(
        next.chains.find((c) => c.id === saved),
        next,
      );
      setNotice("Chain saved. You can try it below.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (
      !id ||
      !(await ask(
        archived
          ? "Restore this chain?"
          : "Move this chain to Deleted? You can restore it later. Its generated media will stay with it.",
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api("archive", { cid: id, version, archived: !archived });
      const next = await refresh(id);
      hydrate(
        next.chains.find((c) => c.id === id),
        next,
      );
      setNotice(
        archived
          ? "Chain restored."
          : "Chain moved to Deleted. Its generated media is still available below.",
      );
      setArchiveView(!archived);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function execute(runId: string, count: number) {
    for (let pos = 1; pos <= count; pos++) {
      setProgress(`Running step ${pos} of ${count}…`);
      await api("step", { rid: runId, pos });
      await refresh();
    }
    setProgress("Run complete.");
    setNotice("Generated media saved to this chain.");
  }
  async function run(existing?: Run) {
    if (!id || (existing && existing.chain_id !== id)) return;
    setRunning(true);
    setError("");
    setNotice("");
    setProgress("Starting your chain…");
    try {
      let runId = existing?.id,
        count = existing
          ? data.runSteps.filter((s) => s.run_id === existing.id).length
          : steps.length;
      if (!runId) {
        runId = await api("begin", { cid: id, version, input }, file);
        const next = await refresh();
        count = next.runSteps.filter((s) => s.run_id === runId).length;
      }
      setSelectedRun(runId!);
      requestAnimationFrame(() =>
        resultsSection.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
      await execute(runId!, count);
    } catch (e) {
      setError((e as Error).message);
      setProgress("Run stopped. See the saved step details below.");
      try {
        await refresh();
      } catch {
        /* Keep the execution error visible. */
      }
    } finally {
      setRunning(false);
    }
  }
  function selectTheme(value: string) {
    localStorage.setItem("chain-theme", value);
    window.dispatchEvent(new Event("chain-theme-change"));
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme =
      value === "system" ? "light dark" : value;
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" href="/">
          h.
          <span>
            HUMOR LAB <b>/ CHAIN TOOL</b>
          </span>
        </Link>
        <div className="top-tools">
          <label className="theme-label">
            Theme
            <select
              aria-label="Color theme"
              value={theme}
              onChange={(e) => selectTheme(e.target.value)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <span className="admin-badge">Superadmin · {userName}</span>
          <form action={signOut}>
            <button className="quiet">Sign out</button>
          </form>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="side-heading">
            <p className="eyebrow">Your workspace</p>
            <h2>
              Prompt chains{" "}
              <span>{data.chains.filter((c) => !c.deleted_at).length}</span>
            </h2>
            <button
              className={`btn primary full ${!id ? "creating" : ""}`}
              onClick={create}
              disabled={busy || running}
              aria-pressed={!id}
            >
              <Icon name="plus" />
              Create chain
            </button>
          </div>
          <div className="side-tabs" aria-label="Chain library filter">
            <button
              aria-pressed={!archiveView}
              className={!archiveView ? "active" : ""}
              onClick={() => setArchiveView(false)}
            >
              Active chains
            </button>
            <button
              aria-pressed={archiveView}
              className={archiveView ? "active" : ""}
              onClick={() => setArchiveView(true)}
            >
              Deleted
            </button>
          </div>
          <nav aria-label="Prompt chains">
            {!id && !archiveView && (
              <div
                className="chain-link selected draft-link"
                aria-current="page"
              >
                <Icon name="edit" />
                <div>
                  <strong>{title}</strong>
                  <small>New chain · unsaved</small>
                </div>
                <span className="selection-dot" />
              </div>
            )}
            {data.chains
              .filter((c) => !!c.deleted_at === archiveView)
              .map((c) => (
                <button
                  key={c.id}
                  disabled={busy || running}
                  aria-current={id === c.id ? "page" : undefined}
                  className={`chain-link ${id === c.id ? "selected" : ""}`}
                  onClick={() => choose(c.id)}
                >
                  <Icon name="chain" />
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {data.steps.filter((s) => s.chain_id === c.id).length}{" "}
                      steps{id === c.id ? " · Selected" : ""}
                    </small>
                  </div>
                  {id === c.id && <span className="selection-dot" />}
                </button>
              ))}
            {!data.chains.some((c) => !!c.deleted_at === archiveView) && (
              <p className="empty-small">
                {archiveView
                  ? "No deleted chains."
                  : "Make your first idea a chain."}
              </p>
            )}
          </nav>
          <div className="sidebar-foot">
            <p>A little structure. A better punchline.</p>
            <small>
              Build a chain, try an image, and keep the results together.
            </small>
            <a
              href="https://humor-lab-admin.vercel.app/"
              target="_blank"
              rel="noreferrer"
            >
              Admin dashboard ↗
            </a>
            <a
              href="https://design-for-gen-ai-project.vercel.app/"
              target="_blank"
              rel="noreferrer"
            >
              Public Humor Lab ↗
            </a>
          </div>
        </aside>
        <main className="main" aria-busy={busy}>
          <section
            className="chain-header"
            ref={chainHeader}
            aria-label="Selected chain"
          >
            <div className="context-line">
              <span className="eyebrow">
                Prompt chains / {id ? "Chain workspace" : "Create a new chain"}
              </span>
              <span className={`status ${dirty ? "unsaved" : "saved"}`}>
                <span className="status-dot" />
                {archived
                  ? "Deleted chain"
                  : !id
                    ? "New chain · unsaved"
                    : dirty
                      ? "Unsaved changes"
                      : "All changes saved"}
              </span>
            </div>
            <div className="title-row">
              <h1 className="sr-only">{id ? title : "Create a new chain"}</h1>
              <input
                ref={nameInput}
                className="chain-title"
                aria-label="Chain name"
                value={name}
                maxLength={120}
                disabled={locked}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
              <Icon name="edit" />
            </div>
            <textarea
              className="chain-description"
              aria-label="Chain description"
              rows={1}
              value={description}
              maxLength={1000}
              disabled={locked}
              placeholder="Add a short description of what this chain should do…"
              onChange={(e) => {
                setDescription(e.target.value);
                setDirty(true);
              }}
            />
            <div className="chain-toolbar">
              <label className="model-label">
                Model
                <select
                  aria-label="Model"
                  value={model}
                  disabled={locked}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setDirty(true);
                  }}
                >
                  {data.models.map((m) => (
                    <option key={m.model_key} value={m.model_key}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="header-actions">
                <button
                  className="quiet danger"
                  disabled={!id || busy || running || dirty}
                  onClick={archive}
                >
                  {archived ? "Restore chain" : "Delete chain"}
                </button>
                <button
                  className="btn primary"
                  disabled={busy || running || archived || !dirty}
                  onClick={save}
                >
                  <Icon name="check" />
                  {busy
                    ? "Please wait…"
                    : !id
                      ? "Save new chain"
                      : dirty
                        ? "Save changes"
                        : "Saved"}
                </button>
              </div>
            </div>
          </section>
          {error && (
            <div role="alert" className="error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="notice">
              <Icon name="check" />
              {notice}
            </p>
          )}
          <nav className="section-nav" aria-label="Sections of this chain">
            <a href="#build">
              <span>1</span>Build steps <b>{steps.length}</b>
            </a>
            <Icon name="chevron" />
            <a href="#try">
              <span>2</span>Try chain
            </a>
            <Icon name="chevron" />
            <a href="#results">
              <span>3</span>Generated media <b>{completeCount}</b>
            </a>
          </nav>
          <section
            className="panel build-section"
            id="build"
            aria-labelledby="build-title"
          >
            <div className="section-heading">
              <div className="section-label">
                <span className="section-number">01</span>
                <div>
                  <h2 id="build-title">Build your chain</h2>
                  <p>
                    Each step passes an idea to the next. Expand a step to edit
                    it.
                  </p>
                </div>
              </div>
              <span className="section-meta">{steps.length} / 8 steps</span>
            </div>
            <div className="steps">
              {steps.map((s, i) => (
                <article
                  key={s.key}
                  className={`step ${expandedStep === s.key ? "expanded" : ""}`}
                >
                  <header className="step-header">
                    <button
                      className="step-toggle"
                      aria-expanded={expandedStep === s.key}
                      aria-controls={`step-${s.key}`}
                      onClick={() =>
                        setExpandedStep(expandedStep === s.key ? null : s.key)
                      }
                    >
                      <span className="step-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="step-title">
                        <strong>{s.name || `Step ${i + 1}`}</strong>
                        <small>
                          {s.input_mode === "original"
                            ? "Original image + scene"
                            : "Previous output + original source"}
                        </small>
                      </span>
                      <Icon name="chevron" className="expand-icon" />
                    </button>
                    <div className="step-actions">
                      <button
                        title="Move up"
                        aria-label={`Move step ${i + 1} up`}
                        disabled={!i || locked}
                        onClick={() => move(i, -1)}
                      >
                        <Icon name="up" />
                      </button>
                      <button
                        title="Move down"
                        aria-label={`Move step ${i + 1} down`}
                        disabled={i === steps.length - 1 || locked}
                        onClick={() => move(i, 1)}
                      >
                        <Icon name="down" />
                      </button>
                      <button
                        className="remove"
                        title="Delete step"
                        aria-label={`Delete step ${i + 1}`}
                        disabled={locked}
                        onClick={() => {
                          setSteps(steps.filter((_, j) => j !== i));
                          setDirty(true);
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  </header>
                  {expandedStep === s.key && (
                    <div className="step-body" id={`step-${s.key}`}>
                      <div className="step-fields">
                        <label>
                          Step name
                          <input
                            aria-label={`Step ${i + 1} name`}
                            maxLength={120}
                            value={s.name}
                            disabled={locked}
                            onChange={(e) =>
                              editStep(i, { name: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Use as input
                          <select
                            aria-label={`Step ${i + 1} input`}
                            value={s.input_mode}
                            disabled={locked}
                            onChange={(e) =>
                              editStep(i, {
                                input_mode: e.target
                                  .value as Step["input_mode"],
                              })
                            }
                          >
                            <option value="original">
                              Original image + scene
                            </option>
                            <option value="previous">
                              Previous output + original source
                            </option>
                          </select>
                        </label>
                      </div>
                      <label>
                        Instructions
                        <textarea
                          aria-label={`Step ${i + 1} instructions`}
                          rows={3}
                          maxLength={4000}
                          value={s.instruction}
                          placeholder="Tell the AI what to do at this step…"
                          disabled={locked}
                          onChange={(e) =>
                            editStep(i, { instruction: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  )}
                </article>
              ))}
            </div>
            {!steps.length && (
              <p className="empty-small">
                Add your first step to tell the AI what to do.
              </p>
            )}
            {!archived && (
              <button
                className="add-step"
                disabled={steps.length >= 8 || locked}
                onClick={addStep}
              >
                <Icon name="plus" />
                Add a step
              </button>
            )}
            {dirty && (
              <div className="save-reminder">
                <span>Save your steps before trying this chain.</span>
                <button
                  className="btn primary"
                  disabled={busy || running || archived}
                  onClick={save}
                >
                  {busy ? "Please wait…" : "Save chain"}
                </button>
              </div>
            )}
          </section>
          <section
            className="panel try-section"
            id="try"
            aria-labelledby="try-title"
          >
            <div className="section-heading">
              <div className="section-label">
                <span className="section-number">02</span>
                <div>
                  <h2 id="try-title">Try this chain</h2>
                  <p>
                    Add an image or describe a scene. Your results will appear
                    right below.
                  </p>
                </div>
              </div>
              <Icon name="play" />
            </div>
            <div className="try-grid">
              <div className="upload">
                <div className="upload-preview">
                  {preview ? (
                    <img src={preview} alt="Selected source preview" />
                  ) : (
                    <>
                      <span className="upload-icon">
                        <Icon name="image" />
                      </span>
                      <strong>Start with an image</strong>
                      <small>JPG, PNG or WebP · up to 4 MB</small>
                    </>
                  )}
                </div>
                <div className="upload-actions">
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={locked}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="image" />
                    {file ? "Change image" : "Choose image"}
                  </button>
                  {file && (
                    <button
                      className="quiet danger"
                      disabled={locked}
                      onClick={() => {
                        setFile(undefined);
                        setPreview("");
                        if (fileInput.current) fileInput.current.value = "";
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <span className="file-name" aria-live="polite">
                  {file?.name ||
                    "An image is optional if you describe a scene."}
                </span>
                <input
                  ref={fileInput}
                  id="source-file"
                  aria-label="Source image"
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp"
                  disabled={locked}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 4194304) {
                      setError("Choose an image under 4 MB.");
                      e.target.value = "";
                      return;
                    }
                    if (
                      !["image/jpeg", "image/png", "image/webp"].includes(
                        f.type,
                      )
                    ) {
                      setError("Choose a JPG, PNG or WebP image.");
                      e.target.value = "";
                      return;
                    }
                    setFile(f);
                    setPreview(URL.createObjectURL(f));
                    setError("");
                  }}
                />
              </div>
              <div className="try-direction">
                <label>
                  Scene or extra direction
                  <textarea
                    aria-label="Scene or extra direction"
                    rows={4}
                    maxLength={2000}
                    placeholder="A student carrying three iced coffees into an 8 a.m. lecture. Keep it playful and relatable."
                    value={input}
                    disabled={locked}
                    onChange={(e) => setInput(e.target.value)}
                  />
                </label>
                <p className="helper">
                  Be specific about the scene, audience, or tone. Every step
                  keeps the original source in context.
                </p>
              </div>
            </div>
            <div className="run-bar">
              <div>
                <strong>{running ? progress : `Run ${title}`}</strong>
                <p aria-live="polite" className="helper">
                  {running
                    ? "You can follow each step in Generated media below."
                    : archived
                      ? "Restore this chain to run it."
                      : dirty || !id
                        ? "Save this chain before generating."
                        : `${steps.length} steps · Results saved to this chain`}
                </p>
              </div>
              <button
                className="btn primary"
                disabled={
                  locked ||
                  dirty ||
                  !id ||
                  !steps.length ||
                  (!file && !input.trim())
                }
                onClick={() => run()}
              >
                <Icon name="play" />
                {running ? "Generating…" : "Generate media"}
              </button>
            </div>
          </section>
          <section
            className="panel results-section"
            id="results"
            ref={resultsSection}
            aria-labelledby="results-title"
            data-chain-id={id ?? "draft"}
          >
            <div className="section-heading">
              <div className="section-label">
                <span className="section-number">03</span>
                <div>
                  <h2 id="results-title">
                    Generated media{" "}
                    <span className="count">{completeCount}</span>
                  </h2>
                  <p>
                    {id ? (
                      <>
                        Results for <strong>{chain?.name}</strong>
                      </>
                    ) : (
                      "Your new chain will have its own results here."
                    )}
                  </p>
                </div>
              </div>
              <span className="section-meta">
                {runs.length ? "Latest 25 runs" : "Ready when you are"}
              </span>
            </div>
            {!runs.length ? (
              <div className="empty">
                <span className="empty-icon">
                  <Icon name="image" />
                </span>
                <h3>
                  {id
                    ? "Your first result starts above."
                    : "A fresh chain. A fresh start."}
                </h3>
                <p>
                  {id
                    ? "Try an image or scene to see what this chain creates. The source, captions, and step history stay together here."
                    : "Save your new chain, then generate media. Its results will stay with this chain."}
                </p>
                <a className="text-link" href={id ? "#try" : "#build"}>
                  {id ? "Try this chain" : "Build your first step"} ↑
                </a>
              </div>
            ) : (
              <>
                <div
                  className="run-list"
                  aria-label="Saved runs for this chain"
                >
                  {runs.map((r) => (
                    <button
                      key={r.id}
                      aria-pressed={viewed?.id === r.id}
                      className={`run-chip ${viewed?.id === r.id ? "selected" : ""}`}
                      onClick={() => setSelectedRun(r.id)}
                    >
                      <span className={`dot ${r.status}`} />
                      <span>
                        {new Date(r.created_at).toLocaleString()}
                        <small>
                          {r.status === "succeeded" ? "Completed" : r.status}
                        </small>
                      </span>
                      {viewed?.id === r.id && <Icon name="check" />}
                    </button>
                  ))}
                </div>
                {viewed && (
                  <article
                    className="run-detail"
                    data-run-chain-id={viewed.chain_id}
                  >
                    <div className="result-context">
                      <span>
                        <Icon name="chain" />
                        {viewed.chain_name}
                      </span>
                      <span className={`pill ${viewed.status}`}>
                        {viewed.status === "succeeded"
                          ? "Completed"
                          : viewed.status}
                      </span>
                    </div>
                    <div className="result-grid">
                      <div className="source">
                        <p className="eyebrow">Original source</p>
                        {viewed.image_url ? (
                          <a
                            href={viewed.image_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={viewed.image_url}
                              alt={
                                viewed.input_text || "Source image for this run"
                              }
                            />
                          </a>
                        ) : (
                          <span className="text-source">
                            <Icon name="edit" />
                            Written scene
                          </span>
                        )}
                        <p>
                          {viewed.input_text ||
                            "Image input · no additional direction"}
                        </p>
                      </div>
                      <div className="result-output">
                        {viewed.status === "succeeded" ? (
                          <>
                            <div className="output-heading">
                              <p className="eyebrow">Generated captions</p>
                              <button
                                className="quiet"
                                onClick={() =>
                                  navigator.clipboard
                                    .writeText(viewed.output_text)
                                    .then(() => setNotice("Output copied."))
                                    .catch(() =>
                                      setError(
                                        "Copy unavailable. Select the output text to copy.",
                                      ),
                                    )
                                }
                              >
                                <Icon name="copy" />
                                Copy output
                              </button>
                            </div>
                            <p className="output-text">{viewed.output_text}</p>
                          </>
                        ) : (
                          <>
                            <h3>
                              {viewed.status === "failed"
                                ? "This run needs another try."
                                : running
                                  ? progress
                                  : "This run is in progress."}
                            </h3>
                            <p className="helper">
                              {viewed.error_message ||
                                "Completed steps are saved below."}
                            </p>
                            {["pending", "running"].includes(viewed.status) && (
                              <button
                                className="btn secondary"
                                disabled={running || busy}
                                onClick={() => run(viewed)}
                              >
                                {running ? "Generating…" : "Resume saved run"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <details className="run-trace">
                      <summary>
                        <Icon name="chain" />
                        <strong>See how this result was made</strong>
                        <span>{runSteps.length} steps</span>
                        <Icon name="chevron" />
                      </summary>
                      <div className="trace-content">
                        <p className="helper">
                          These are the saved prompts from this run, even if you
                          edit the chain later. Model: {viewed.model_key}.
                        </p>
                        {runSteps.map((s) => (
                          <details
                            className="trace"
                            key={s.id}
                            open={s.status === "failed"}
                          >
                            <summary>
                              <span className="step-number">{s.position}</span>
                              <strong>{s.name}</strong>
                              <small>
                                {s.status}
                                {s.latency_ms !== null
                                  ? ` · ${(s.latency_ms / 1000).toFixed(1)}s`
                                  : ""}
                              </small>
                            </summary>
                            <p className="eyebrow">Saved instruction</p>
                            <pre>{s.instruction}</pre>
                            <p className="eyebrow">
                              {s.input_mode === "previous"
                                ? "Previous output + original source"
                                : "Original source"}
                            </p>
                            <details>
                              <summary>View exact submitted prompt</summary>
                              <pre>{s.prompt_text || "Not run yet."}</pre>
                            </details>
                            <p className="eyebrow">Step output</p>
                            <pre>
                              {s.output_text ||
                                s.error_message ||
                                "Waiting for this step."}
                            </pre>
                          </details>
                        ))}
                      </div>
                    </details>
                  </article>
                )}
              </>
            )}
          </section>
          <footer className="footer">
            <span>HUMOR LAB / CHAIN TOOL</span>
            <span>Google login · Superadmin access</span>
          </footer>
        </main>
      </div>
      {dialog && (
        <dialog
          className="modal panel"
          ref={confirmDialog}
          aria-labelledby="confirm-title"
          onCancel={(e) => {
            e.preventDefault();
            answer(false);
          }}
        >
          <h2 id="confirm-title">Confirm change</h2>
          <p>{dialog.message}</p>
          <div>
            <button
              className="btn secondary"
              autoFocus
              onClick={() => answer(false)}
            >
              Cancel
            </button>
            <button className="btn primary" onClick={() => answer(true)}>
              Continue
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
