---
name: thinkstock-architecture
description: Inspect ThinkStock's current code and create or update Mermaid architecture diagrams for its boot, data, cache, analysis, chart, and deployment flows. Use for architecture visualization or structural audits, not ordinary feature implementation.
---

# ThinkStock Architecture

Create maintainable, evidence-based diagrams rather than decorative snapshots.

## Workflow

1. Read `AGENTS.md`, `package.json`, and the relevant current source modules.
2. Read `THINKSTOCK_BOOT_PIPELINE_SPEC.md` only when the request concerns boot or data dependencies. Treat anything marked proposed as a target, not verified implementation.
3. Ignore `node_modules`, generated bundles in `docs/assets`, caches, and test output when discovering architecture.
4. Update only the relevant section of `docs/architecture/THINKSTOCK_ARCHITECTURE.md`.
5. Record the principal source files used as evidence below the diagrams.

## Diagram Rules

- Use Mermaid inside Markdown so GitHub and local Markdown previews can render it without a paid service.
- Use Korean labels for product concepts and short ASCII identifiers for Mermaid nodes.
- Separate current behavior from proposed behavior. Never present a specification as already implemented.
- Show one owner for shared state or coordination. Draw consumers beneath that owner instead of duplicating equivalent controllers.
- Distinguish synchronous flow, conditional work, cache reuse, and external requests when that distinction matters.
- Keep each diagram focused. Prefer system context, boot/data pipeline, and chart interaction as separate diagrams.
- Avoid file-by-file dependency graphs unless the user explicitly requests them.
- Do not change application code while updating diagrams unless the user separately requests implementation.
- If the code contradicts an invariant or document, report the discrepancy instead of silently choosing one version.

## Output

- Canonical editable artifact: `docs/architecture/THINKSTOCK_ARCHITECTURE.md`
- Optional exports: SVG or PNG only when requested.
- Do not require Mermaid Chart, an account, or an external AI service.

