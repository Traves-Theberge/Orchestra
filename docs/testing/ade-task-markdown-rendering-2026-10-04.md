# Task and issue Markdown rendering receipt

## References inspected before implementation

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`, `apps/web/src/components/pullRequest/PullRequestMarkdown.tsx`: document bodies reuse the shared `ChatMarkdown` renderer, with scoped thread/cwd context and explicit attachment handling. Orchestra similarly reuses its existing `MarkdownRenderer` for task and issue descriptions rather than adding another parser.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, `src/renderer/src/components/LinearIssueMarkdownDescriptionEditor.tsx`: issue descriptions have a rich Markdown surface, retain their Markdown source through the editor codec and stay synchronized with the tracker value. Orchestra keeps its existing Markdown preview/source-editor workflow and prevents preview links/code controls from switching it into edit mode.
- Deliberate differences: no new Tiptap editor, media fetch service or repository autolink transport was added. Raw HTML remains non-executable through Orchestra's existing React Markdown/sanitization path. Neither reference application was exercised; inspected source does not prove reference or Orchestra E2E reliability.

## Changes and verification

Read-only task details, the legacy task overview description, tracker item details and expanded GitHub issue descriptions now use the shared renderer and existing typography styles. Task/tracker links retain the owning project ID where that context is available. The Backlog source editor still exposes the original Markdown for editing; clicking a preview link or code control no longer enters editing.

Four focused `task-markdown.test.tsx` tests use the real shared renderer to verify headings, emphasis, unordered/ordered lists, checked tasks, code blocks, tables, project-scoped links and unchanged editor source across the actual task/tracker/GitHub surfaces. Fixtures verify that script elements, executable HTML event attributes and `javascript:` links are absent. Tests pass; desktop typecheck passes. Scoped ESLint reports zero errors and two existing unused-symbol warnings in `IssueDetailView.tsx`.

This package verifies component behavior under DOM tests. It does not claim a native desktop visual audit, remote link availability or tracker save E2E proof. Markdown source in the active editing textarea intentionally remains source text.
