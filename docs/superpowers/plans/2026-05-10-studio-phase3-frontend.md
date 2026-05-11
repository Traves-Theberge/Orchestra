# Task Authoring Studio — Phase 3: Frontend Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `Studio` top-level section in the Electron desktop app — a two-pane authoring surface with a chat thread on the left (reusing the embedded-agent's chat components) and a live-updating task draft panel on the right. SSE wires the right pane to the backend `studio.Manager`'s draft state.

**Architecture:** New `apps/desktop/src/features/studio/` module. `StudioSection` is the route component. `useStudioSession` owns the SSE subscription and exposes actions (send message, edit draft, push, discard). `useDraft` mirrors the server-side draft snapshot. The chat surface is a thin wrapper around existing embedded-agent components. Lazy-loaded into `App.tsx`'s section router.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4. Existing `lib/orchestra-client.ts` for HTTP, native `EventSource` for SSE. No new state library — local hooks + server-as-source-of-truth.

**Prerequisite:** Phase 1 backend merged. Phase 2 helps but isn't strictly required (a session against the fake runner still proves the UI works end-to-end).

---

## File Structure

**New files (all under `apps/desktop/src/features/studio/`):**
- `index.ts` — re-exports `StudioSection`
- `StudioSection.tsx` — top-level route, two-pane layout
- `api/studio-client.ts` — typed wrapper over the orchestra HTTP client
- `chat/StudioChat.tsx` — chat thread (wraps embedded-agent components)
- `chat/ChatComposer.tsx` — message input + runner picker + send
- `chat/useStudioSession.ts` — SSE + actions
- `draft/DraftPanel.tsx` — right-pane container
- `draft/useDraft.ts` — local mirror, optimistic edits with server echo override
- `draft/fields/BasicsFields.tsx`
- `draft/fields/AcceptanceCriteria.tsx`
- `draft/fields/Attachments.tsx`
- `draft/fields/ProviderPicker.tsx`
- `draft/fields/AgentGuidance.tsx`
- `draft/fields/TemplatePicker.tsx` (stub — full impl in Phase 4)

**Modified files:**
- `apps/desktop/src/App.tsx` — add `studio` to the section router with `React.lazy`
- `apps/desktop/src/lib/orchestra-client.ts` — add studio HTTP methods

---

## Task 1: HTTP client methods

**Files:**
- Modify: `apps/desktop/src/lib/orchestra-client.ts`
- Test: a sibling `orchestra-client.studio.test.ts` (create)

- [ ] **Step 1: Failing test**

```ts
// apps/desktop/src/lib/orchestra-client.studio.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestraClient } from "./orchestra-client";

describe("OrchestraClient studio", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: OrchestraClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new OrchestraClient({ baseUrl: "http://test", token: "tok" });
  });

  it("creates studio session", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ session_id: "sess1", sse_url: "/api/studio/sessions/sess1/events" }),
    });
    const res = await client.createStudioSession({ project_id: "p", runner: "claude-code" });
    expect(res.session_id).toBe("sess1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test/api/studio/sessions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("patches draft", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    await client.patchStudioDraft("sess1", { title: "T" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test/api/studio/sessions/sess1/draft",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("pushes to backlog", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ issue_id: "ISS-1" }) });
    const res = await client.pushStudioToBacklog("sess1");
    expect(res.issue_id).toBe("ISS-1");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/desktop && npx vitest run src/lib/orchestra-client.studio.test.ts`
Expected: FAIL — `client.createStudioSession is not a function`.

- [ ] **Step 3: Implement**

Open `apps/desktop/src/lib/orchestra-client.ts`. Add methods (match existing style):

```ts
// Types
export interface StartStudioSession {
  project_id: string;
  runner: string;
  template?: string;
  template_vars?: Record<string, string>;
}

export interface StudioSessionHandle {
  session_id: string;
  sse_url: string;
}

export interface StudioDraft {
  session_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  attachments: Array<{ kind: "file" | "link"; path?: string; url?: string; label?: string }>;
  suggested_provider: string;
  suggested_model: string;
  max_turns?: number;
  template_name?: string;
  template_vars: Record<string, string>;
  agent_guidance: Record<string, unknown>;
}

// Methods on OrchestraClient
async createStudioSession(body: StartStudioSession): Promise<StudioSessionHandle> {
  return this.request("POST", "/api/studio/sessions", body);
}

async sendStudioMessage(sessionId: string, message: string): Promise<void> {
  await this.request("POST", `/api/studio/sessions/${sessionId}/message`, { message });
}

async getStudioDraft(sessionId: string): Promise<StudioDraft> {
  return this.request("GET", `/api/studio/sessions/${sessionId}/draft`);
}

async patchStudioDraft(sessionId: string, patch: Partial<StudioDraft>): Promise<void> {
  await this.request("POST", `/api/studio/sessions/${sessionId}/draft`, patch);
}

async pushStudioToBacklog(sessionId: string): Promise<{ issue_id: string }> {
  return this.request("POST", `/api/studio/sessions/${sessionId}/push`, undefined);
}

async discardStudioSession(sessionId: string): Promise<void> {
  await this.request("DELETE", `/api/studio/sessions/${sessionId}`);
}

studioEventsURL(sessionId: string): string {
  return `${this.baseUrl}/api/studio/sessions/${sessionId}/events`;
}
```

Adjust `this.request` calls to match the existing helper's signature (most clients in this codebase have a similar method — see other endpoints for the pattern).

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/desktop && npx vitest run src/lib/orchestra-client.studio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/orchestra-client.ts apps/desktop/src/lib/orchestra-client.studio.test.ts
git commit -m "feat(desktop): studio HTTP client methods"
```

---

## Task 2: `useDraft` hook — local mirror with server echo

**Files:**
- Create: `apps/desktop/src/features/studio/draft/useDraft.ts`
- Test: `apps/desktop/src/features/studio/draft/useDraft.test.ts`

- [ ] **Step 1: Failing test**

```ts
// apps/desktop/src/features/studio/draft/useDraft.test.ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraft } from "./useDraft";

const empty = {
  session_id: "sess1",
  title: "",
  description: "",
  acceptance_criteria: [],
  attachments: [],
  suggested_provider: "",
  suggested_model: "",
  template_vars: {},
  agent_guidance: {},
};

describe("useDraft", () => {
  it("starts empty when no initial value", () => {
    const { result } = renderHook(() => useDraft("sess1"));
    expect(result.current.draft).toBeNull();
  });

  it("server snapshot overrides local optimistic edits", () => {
    const { result } = renderHook(() => useDraft("sess1"));
    act(() => result.current.applyServerSnapshot(empty));
    act(() => result.current.setLocal({ title: "Optimistic" }));
    expect(result.current.draft?.title).toBe("Optimistic");
    act(() => result.current.applyServerSnapshot({ ...empty, title: "Server" }));
    expect(result.current.draft?.title).toBe("Server");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/desktop && npx vitest run src/features/studio/draft/useDraft.test.ts`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Implement**

```tsx
// apps/desktop/src/features/studio/draft/useDraft.ts
import { useCallback, useState } from "react";
import type { StudioDraft } from "@/lib/orchestra-client";

export function useDraft(_sessionId: string) {
  const [draft, setDraft] = useState<StudioDraft | null>(null);

  const applyServerSnapshot = useCallback((snap: StudioDraft) => {
    setDraft(snap);
  }, []);

  const setLocal = useCallback((patch: Partial<StudioDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  return { draft, applyServerSnapshot, setLocal };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/desktop && npx vitest run src/features/studio/draft/useDraft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/studio/draft/
git commit -m "feat(studio): useDraft hook with server-echo precedence"
```

---

## Task 3: `useStudioSession` — SSE subscription + actions

**Files:**
- Create: `apps/desktop/src/features/studio/chat/useStudioSession.ts`
- Test: `apps/desktop/src/features/studio/chat/useStudioSession.test.ts`

- [ ] **Step 1: Failing test**

Use `vitest`'s timer + a fake EventSource:

```tsx
// apps/desktop/src/features/studio/chat/useStudioSession.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStudioSession } from "./useStudioSession";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  emit(data: object) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  close() {}
}

const mockClient = {
  studioEventsURL: (id: string) => `/sse/${id}`,
  sendStudioMessage: vi.fn(),
  patchStudioDraft: vi.fn(),
  pushStudioToBacklog: vi.fn().mockResolvedValue({ issue_id: "ISS-1" }),
  discardStudioSession: vi.fn(),
  getStudioDraft: vi.fn().mockResolvedValue({
    session_id: "sess1", title: "", description: "", acceptance_criteria: [], attachments: [],
    suggested_provider: "", suggested_model: "", template_vars: {}, agent_guidance: {},
  }),
};

describe("useStudioSession", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (global as any).EventSource = FakeEventSource;
  });

  it("subscribes and applies draft updates from SSE", async () => {
    const { result } = renderHook(() => useStudioSession("sess1", mockClient as any));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => {
      FakeEventSource.instances[0].emit({
        session_id: "sess1",
        kind: "draft.updated",
        payload: {
          session_id: "sess1", title: "From SSE", description: "", acceptance_criteria: [], attachments: [],
          suggested_provider: "", suggested_model: "", template_vars: {}, agent_guidance: {},
        },
      });
    });
    expect(result.current.draft?.title).toBe("From SSE");
  });

  it("appends chat messages from SSE", () => {
    const { result } = renderHook(() => useStudioSession("sess1", mockClient as any));
    act(() => {
      FakeEventSource.instances[0].emit({ session_id: "sess1", kind: "chat.message", payload: { role: "agent", text: "Hi" } });
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: "agent", text: "Hi" });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/desktop && npx vitest run src/features/studio/chat/useStudioSession.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/desktop/src/features/studio/chat/useStudioSession.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrchestraClient, StudioDraft } from "@/lib/orchestra-client";
import { useDraft } from "../draft/useDraft";

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  tool?: { name: string; args: unknown };
  ts: number;
}

interface StudioEvent {
  session_id: string;
  kind: string;
  payload: unknown;
}

export function useStudioSession(sessionId: string, client: OrchestraClient) {
  const { draft, applyServerSnapshot, setLocal } = useDraft(sessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.getStudioDraft(sessionId).then((d) => {
      if (!cancelled) applyServerSnapshot(d);
    }).catch(() => {});

    const es = new EventSource(client.studioEventsURL(sessionId));
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as StudioEvent;
        switch (ev.kind) {
          case "draft.updated":
            applyServerSnapshot(ev.payload as StudioDraft);
            break;
          case "chat.message": {
            const p = ev.payload as { role: ChatMessage["role"]; text: string };
            setMessages((prev) => [...prev, { role: p.role, text: p.text, ts: Date.now() }]);
            break;
          }
          case "tool.call": {
            const p = ev.payload as { name: string; args: unknown };
            setMessages((prev) => [...prev, { role: "agent", text: "", tool: p, ts: Date.now() }]);
            break;
          }
        }
      } catch {
        // ignore malformed events
      }
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [sessionId, client, applyServerSnapshot]);

  const sendMessage = useCallback(async (text: string) => {
    setMessages((prev) => [...prev, { role: "user", text, ts: Date.now() }]);
    await client.sendStudioMessage(sessionId, text);
  }, [sessionId, client]);

  const editDraft = useCallback(async (patch: Partial<StudioDraft>) => {
    setLocal(patch);
    await client.patchStudioDraft(sessionId, patch);
  }, [sessionId, client, setLocal]);

  const push = useCallback(() => client.pushStudioToBacklog(sessionId), [sessionId, client]);
  const discard = useCallback(() => client.discardStudioSession(sessionId), [sessionId, client]);

  return { draft, messages, connected, sendMessage, editDraft, push, discard };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/desktop && npx vitest run src/features/studio/chat/useStudioSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/studio/chat/
git commit -m "feat(studio): useStudioSession hook with SSE wiring"
```

---

## Task 4: Draft field components

**Files:**
- Create: `apps/desktop/src/features/studio/draft/fields/BasicsFields.tsx`
- Create: `apps/desktop/src/features/studio/draft/fields/AcceptanceCriteria.tsx`
- Create: `apps/desktop/src/features/studio/draft/fields/Attachments.tsx`
- Create: `apps/desktop/src/features/studio/draft/fields/ProviderPicker.tsx`
- Create: `apps/desktop/src/features/studio/draft/fields/AgentGuidance.tsx`
- Create: `apps/desktop/src/features/studio/draft/fields/TemplatePicker.tsx`

These are leaf components. Each receives `draft` and `onChange(patch: Partial<StudioDraft>)` props. Use Tailwind v4 utility classes consistent with the rest of the app.

- [ ] **Step 1: `BasicsFields.tsx`**

```tsx
import type { StudioDraft } from "@/lib/orchestra-client";

export function BasicsFields({
  draft,
  onChange,
}: {
  draft: StudioDraft;
  onChange: (patch: Partial<StudioDraft>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase opacity-60">Title</span>
        <input
          className="bg-transparent border-b border-white/20 px-1 py-1 outline-none focus:border-white/60"
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="What needs to happen?"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase opacity-60">Description</span>
        <textarea
          rows={6}
          className="bg-transparent border border-white/20 rounded p-2 outline-none focus:border-white/60 resize-y"
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Describe the task in markdown"
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: `AcceptanceCriteria.tsx`**

```tsx
import { useState } from "react";
import type { StudioDraft } from "@/lib/orchestra-client";

export function AcceptanceCriteria({
  draft,
  onChange,
}: {
  draft: StudioDraft;
  onChange: (patch: Partial<StudioDraft>) => void;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    if (!input.trim()) return;
    onChange({ acceptance_criteria: [...draft.acceptance_criteria, input.trim()] });
    setInput("");
  };
  const remove = (i: number) => {
    onChange({ acceptance_criteria: draft.acceptance_criteria.filter((_, idx) => idx !== i) });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase opacity-60">Acceptance criteria</div>
      <ul className="flex flex-col gap-1">
        {draft.acceptance_criteria.map((c, i) => (
          <li key={i} className="flex items-start gap-2 group">
            <input type="checkbox" disabled className="mt-1" />
            <span className="flex-1">{c}</span>
            <button onClick={() => remove(i)} className="opacity-0 group-hover:opacity-100 text-xs opacity-60 hover:opacity-100">×</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Add criterion…"
        />
        <button onClick={add} className="px-2 py-1 text-sm bg-white/10 rounded">Add</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `Attachments.tsx`**

```tsx
import { useState } from "react";
import type { StudioDraft } from "@/lib/orchestra-client";

export function Attachments({
  draft,
  onChange,
}: {
  draft: StudioDraft;
  onChange: (patch: Partial<StudioDraft>) => void;
}) {
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");

  const addFile = () => {
    if (!path.trim()) return;
    onChange({ attachments: [...draft.attachments, { kind: "file", path: path.trim() }] });
    setPath("");
  };
  const addLink = () => {
    if (!url.trim()) return;
    onChange({ attachments: [...draft.attachments, { kind: "link", url: url.trim() }] });
    setUrl("");
  };
  const remove = (i: number) => {
    onChange({ attachments: draft.attachments.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase opacity-60">Attachments</div>
      <ul className="flex flex-col gap-1">
        {draft.attachments.map((a, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="opacity-60">{a.kind === "file" ? "📄" : "🔗"}</span>
            <span className="flex-1 truncate">{a.path ?? a.url}</span>
            <button onClick={() => remove(i)} className="opacity-60 hover:opacity-100 text-xs">×</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="File path"
        />
        <button onClick={addFile} className="px-2 py-1 text-sm bg-white/10 rounded">+ file</button>
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link URL"
        />
        <button onClick={addLink} className="px-2 py-1 text-sm bg-white/10 rounded">+ link</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `ProviderPicker.tsx`**

```tsx
import type { StudioDraft } from "@/lib/orchestra-client";

const PROVIDERS = ["claude-code", "codex", "opencode", "gemini"] as const;

export function ProviderPicker({
  draft,
  onChange,
}: {
  draft: StudioDraft;
  onChange: (patch: Partial<StudioDraft>) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase opacity-60">Execution provider</span>
      <select
        className="bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
        value={draft.suggested_provider}
        onChange={(e) => onChange({ suggested_provider: e.target.value })}
      >
        <option value="">— orchestrator chooses —</option>
        {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </label>
  );
}
```

- [ ] **Step 5: `AgentGuidance.tsx`**

```tsx
import type { StudioDraft } from "@/lib/orchestra-client";

export function AgentGuidance({
  draft,
  onChange,
}: {
  draft: StudioDraft;
  onChange: (patch: Partial<StudioDraft>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase opacity-60">Agent guidance</div>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 opacity-60">Model</span>
        <input
          className="flex-1 bg-transparent border border-white/20 rounded px-2 py-1"
          value={draft.suggested_model}
          onChange={(e) => onChange({ suggested_model: e.target.value })}
          placeholder="e.g. opus, sonnet"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 opacity-60">Max turns</span>
        <input
          type="number"
          min={1}
          className="w-24 bg-transparent border border-white/20 rounded px-2 py-1"
          value={draft.max_turns ?? ""}
          onChange={(e) => onChange({ max_turns: e.target.value ? Number(e.target.value) : undefined })}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 6: `TemplatePicker.tsx` (stub for Phase 4)**

```tsx
import type { StudioDraft } from "@/lib/orchestra-client";

export function TemplatePicker({
  draft,
}: {
  draft: StudioDraft;
  onChange: (patch: Partial<StudioDraft>) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="opacity-60">Template:</span>
      <span>{draft.template_name || "—"}</span>
      <button disabled className="ml-auto opacity-40 cursor-not-allowed text-xs">Browse (Phase 4)</button>
    </div>
  );
}
```

- [ ] **Step 7: Component test for AcceptanceCriteria**

```tsx
// apps/desktop/src/features/studio/draft/fields/AcceptanceCriteria.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AcceptanceCriteria } from "./AcceptanceCriteria";

const baseDraft = {
  session_id: "s", title: "", description: "", acceptance_criteria: ["a", "b"],
  attachments: [], suggested_provider: "", suggested_model: "", template_vars: {}, agent_guidance: {},
} as any;

describe("AcceptanceCriteria", () => {
  it("adds via enter", () => {
    const onChange = vi.fn();
    render(<AcceptanceCriteria draft={baseDraft} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add criterion…");
    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ acceptance_criteria: ["a", "b", "c"] });
  });

  it("removes on ×", () => {
    const onChange = vi.fn();
    render(<AcceptanceCriteria draft={baseDraft} onChange={onChange} />);
    const buttons = screen.getAllByText("×");
    fireEvent.click(buttons[0]);
    expect(onChange).toHaveBeenCalledWith({ acceptance_criteria: ["b"] });
  });
});
```

Run: `cd apps/desktop && npx vitest run src/features/studio/draft/fields/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/features/studio/draft/fields/
git commit -m "feat(studio): draft field components"
```

---

## Task 5: `DraftPanel.tsx` — assemble the right pane

**Files:**
- Create: `apps/desktop/src/features/studio/draft/DraftPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/desktop/src/features/studio/draft/DraftPanel.tsx
import type { StudioDraft } from "@/lib/orchestra-client";
import { BasicsFields } from "./fields/BasicsFields";
import { AcceptanceCriteria } from "./fields/AcceptanceCriteria";
import { Attachments } from "./fields/Attachments";
import { ProviderPicker } from "./fields/ProviderPicker";
import { AgentGuidance } from "./fields/AgentGuidance";
import { TemplatePicker } from "./fields/TemplatePicker";

export interface DraftPanelProps {
  draft: StudioDraft;
  onChange: (patch: Partial<StudioDraft>) => void;
  onPush: () => void;
  onDiscard: () => void;
  pushing?: boolean;
  pushDisabledReason?: string;
}

export function DraftPanel({ draft, onChange, onPush, onDiscard, pushing, pushDisabledReason }: DraftPanelProps) {
  return (
    <div className="h-full flex flex-col border-l border-white/10">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
        <h2 className="text-sm font-medium">Task draft</h2>
        <TemplatePicker draft={draft} onChange={onChange} />
        <button onClick={onDiscard} className="ml-auto text-xs opacity-60 hover:opacity-100">Discard</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        <BasicsFields draft={draft} onChange={onChange} />
        <AcceptanceCriteria draft={draft} onChange={onChange} />
        <Attachments draft={draft} onChange={onChange} />
        <ProviderPicker draft={draft} onChange={onChange} />
        <AgentGuidance draft={draft} onChange={onChange} />
      </div>
      <div className="px-4 py-3 border-t border-white/10 flex flex-col gap-1">
        {pushDisabledReason && (
          <div className="text-xs text-yellow-400">{pushDisabledReason}</div>
        )}
        <button
          onClick={onPush}
          disabled={pushing || !!pushDisabledReason}
          className="w-full py-2 rounded bg-sky-500 text-black font-medium hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pushing ? "Pushing…" : "→ Push to backlog"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/features/studio/draft/DraftPanel.tsx
git commit -m "feat(studio): DraftPanel assembling all field components"
```

---

## Task 6: Chat components

**Files:**
- Create: `apps/desktop/src/features/studio/chat/StudioChat.tsx`
- Create: `apps/desktop/src/features/studio/chat/ChatComposer.tsx`

Reuse message rendering from `components/embedded-agent/` if it exports usable subcomponents. If it doesn't expose them cleanly, render a minimal version here and refactor in a follow-up.

- [ ] **Step 1: Implement `ChatComposer.tsx`**

```tsx
// apps/desktop/src/features/studio/chat/ChatComposer.tsx
import { useState } from "react";

export function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div className="border-t border-white/10 p-3 flex gap-2 items-end">
      <textarea
        rows={2}
        className="flex-1 bg-transparent border border-white/20 rounded p-2 outline-none focus:border-white/60 resize-none text-sm"
        placeholder="Describe what you want to task out…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="px-3 py-2 bg-sky-500 text-black rounded text-sm disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implement `StudioChat.tsx`**

```tsx
// apps/desktop/src/features/studio/chat/StudioChat.tsx
import { useEffect, useRef } from "react";
import type { ChatMessage } from "./useStudioSession";
import { ChatComposer } from "./ChatComposer";

export function StudioChat({
  messages,
  onSend,
  sendDisabled,
  runner,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  sendDisabled?: boolean;
  runner: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
        <h2 className="text-sm font-medium">Studio</h2>
        <span className="text-xs opacity-60">via {runner}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm opacity-60">Tell the agent what task you want to author. It can read your repo while it helps.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            {m.tool ? (
              <div className="inline-block text-xs bg-white/5 border border-white/10 rounded px-2 py-1">
                <span className="opacity-60">tool:</span> {m.tool.name}
              </div>
            ) : (
              <div className={`inline-block max-w-[80%] rounded p-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-sky-600/20" : "bg-white/5"}`}>
                {m.text}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <ChatComposer onSend={onSend} disabled={sendDisabled} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/studio/chat/
git commit -m "feat(studio): chat components"
```

---

## Task 7: `StudioSection.tsx` — assemble the section

**Files:**
- Create: `apps/desktop/src/features/studio/StudioSection.tsx`
- Create: `apps/desktop/src/features/studio/index.ts`

- [ ] **Step 1: Implement**

```tsx
// apps/desktop/src/features/studio/StudioSection.tsx
import { useEffect, useState } from "react";
import type { OrchestraClient } from "@/lib/orchestra-client";
import { useStudioSession } from "./chat/useStudioSession";
import { StudioChat } from "./chat/StudioChat";
import { DraftPanel } from "./draft/DraftPanel";

export interface StudioSectionProps {
  client: OrchestraClient;
  projectId: string;
}

const RUNNERS = ["claude-code", "codex", "opencode", "gemini"];

export function StudioSection({ client, projectId }: StudioSectionProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [runner, setRunner] = useState(RUNNERS[0]);
  const [pushing, setPushing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (sessionId) return;
    client.createStudioSession({ project_id: projectId, runner }).then((h) => setSessionId(h.session_id));
  }, [client, projectId, runner, sessionId]);

  if (!sessionId) {
    return <div className="p-6 text-sm opacity-60">Starting studio session…</div>;
  }
  return <StudioBody
    sessionId={sessionId}
    runner={runner}
    client={client}
    pushing={pushing}
    setPushing={setPushing}
    onPushed={(issueId) => {
      setToast(`Pushed to backlog: ${issueId}`);
      setSessionId(null); // triggers a fresh session
    }}
    onDiscarded={() => setSessionId(null)}
    toast={toast}
    clearToast={() => setToast(null)}
  />;
}

function StudioBody({
  sessionId, runner, client, pushing, setPushing, onPushed, onDiscarded, toast, clearToast,
}: {
  sessionId: string;
  runner: string;
  client: OrchestraClient;
  pushing: boolean;
  setPushing: (b: boolean) => void;
  onPushed: (issueId: string) => void;
  onDiscarded: () => void;
  toast: string | null;
  clearToast: () => void;
}) {
  const { draft, messages, sendMessage, editDraft, push, discard } = useStudioSession(sessionId, client);

  const pushDisabledReason = !draft
    ? "Loading draft…"
    : !draft.title.trim()
    ? "Title required"
    : !draft.description.trim()
    ? "Description required"
    : undefined;

  const handlePush = async () => {
    setPushing(true);
    try {
      const { issue_id } = await push();
      onPushed(issue_id);
    } finally {
      setPushing(false);
    }
  };

  const handleDiscard = async () => {
    await discard();
    onDiscarded();
  };

  return (
    <div className="h-full flex relative">
      <div className="flex-[1.4] min-w-0">
        <StudioChat messages={messages} onSend={sendMessage} runner={runner} />
      </div>
      <div className="flex-1 min-w-0">
        {draft && (
          <DraftPanel
            draft={draft}
            onChange={editDraft}
            onPush={handlePush}
            onDiscard={handleDiscard}
            pushing={pushing}
            pushDisabledReason={pushDisabledReason}
          />
        )}
      </div>
      {toast && (
        <button
          onClick={clearToast}
          className="absolute bottom-4 right-4 bg-sky-600 text-white text-sm px-3 py-2 rounded shadow"
        >
          {toast}
        </button>
      )}
    </div>
  );
}
```

```ts
// apps/desktop/src/features/studio/index.ts
export { StudioSection } from "./StudioSection";
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/features/studio/StudioSection.tsx apps/desktop/src/features/studio/index.ts
git commit -m "feat(studio): StudioSection composing chat and draft panes"
```

---

## Task 8: Wire into `App.tsx`

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add lazy import**

Near other lazy section imports in `App.tsx`:

```tsx
const StudioSection = React.lazy(() =>
  import("@features/studio").then((m) => ({ default: m.StudioSection }))
);
```

- [ ] **Step 2: Add to section router**

Find the `switch (section)` or equivalent. Add:

```tsx
case "studio":
  return (
    <Suspense fallback={<div className="p-6 opacity-60">Loading studio…</div>}>
      <StudioSection client={client} projectId={activeProjectId} />
    </Suspense>
  );
```

- [ ] **Step 3: Add sidebar entry**

Wherever sidebar navigation is rendered, add a "Studio" item (icon + label) that sets `section = "studio"`. Match the existing sidebar item component.

- [ ] **Step 4: Typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Lint**

Run: `cd apps/desktop && npm run lint`
Expected: no errors.

- [ ] **Step 6: Smoke (manual)**

Boot backend + desktop:
```bash
cd apps/backend && ORCHESTRA_API_TOKEN=dev-token ORCHESTRA_WORKSPACE_ROOT=/tmp/orchestra ./orchestrad &
cd apps/desktop && npm run dev:linux
```

Open the app, click `Studio` in the sidebar. Verify:
- A session starts (network tab shows `POST /api/studio/sessions` returning 201).
- SSE connects (`GET /api/studio/sessions/<id>/events`).
- Editing the title in the draft panel persists (`POST /draft`).
- "Push to backlog" creates an issue (visible on Kanban).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(desktop): Studio section in sidebar router"
```

---

## Task 9: Test suite verification

- [ ] `cd apps/desktop && npx vitest run` — all pass.
- [ ] `cd apps/desktop && npx tsc --noEmit` — clean.
- [ ] `cd apps/desktop && npm run lint` — clean.

## Phase 3 Complete

Users can author tasks in the studio: chat with a CLI agent, watch the draft fill in live, edit any field manually, push to backlog. The full loop works end-to-end against either Phase 1's fake runner or Phase 2's real CLI agents.
