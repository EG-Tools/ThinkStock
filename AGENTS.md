# Repository Agent Guide

## 최우선 작업 원칙: 기존 방식 확인

- 사용자 요청을 구현하기 전에 기존 UI·디자인·동작·구현 방식을 먼저 확인하고 재사용한다.
- 요청의 해석이나 제안한 구현이 기존 방식과 달라질 경우, 변경 전에 차이점과 이유를 설명하고 사용자에게 확인 질문을 한다. 답변을 받기 전에는 해당 차이를 임의로 구현하지 않는다.
- 사용자가 이미 명확히 지정하거나 승인한 변경은 그 범위 안에서 진행하며, 추가 차이가 생길 때 다시 확인한다.

## Product
- ThinkStock has one user-facing web app in `docs/`.
- Local PC access uses `run_local_pages.bat` and `scripts/local_pages_server.mjs`.
- External PC and iPhone access use `https://eg-tools.github.io/ThinkStock/`.
- Do not recreate separate Streamlit, native iOS, or alternate UI implementations.

## Data Flow
- Local mode prefers the validated mirror in `.thinkstock-cache/pages-data` and falls back to bundled `docs/data`.
- GitHub Pages uses the segmented datasets in `docs/data`.
- `scripts/build_pages_data.py` refreshes deployment data.
- Protected runtime calls go through `worker/`; secrets must never enter the public bundle.

## Editing Rules
- Preserve the Korean UX and mobile-first behavior unless there is a clear improvement.
- Keep local and deployed behavior identical by changing the shared `docs/` source only.
- Keep `main` as the only long-lived deployment branch.
- Run unit validation and Safari/iPhone WebKit coverage before release.
- Run Chrome DevTools MCP audits in one separate isolated browser window or context. Never navigate, refresh, close, or otherwise reuse the browser window the user is currently viewing. When an audit needs multiple pages, open and manage them as tabs in that single test window/context instead of creating additional windows.
- Before implementing any behavior, identify existing contracts, reusable modules, and every related UI, data, input, cache, local/deployed, and desktop/mobile path that can share it. If the commonization boundary changes behavior or performance, stop and confirm that boundary with the user before editing.
- Treat that inspection as an implementation gate, not optional cleanup. Name the existing owner and extension point before editing; verify the proposed feature preserves topology across every on/off and input state; and reject any design that adds a second renderer, scheduler, synchronization path, style value, or state owner for equivalent behavior. Extend the shared registry or contract first, then add only the feature-specific calculation or exception.

## Change Completion
- End every feature, fix, or optimization with a bounded closeout pass before reporting completion.
- The closeout pass MUST inspect the resulting diff, re-check affected shared contracts and call order, remove superseded temporary or duplicate paths, run focused source and behavior tests, and verify that shared local/deployed and desktop/mobile paths remain aligned.
- Keep this pass proportional to the change. Do not turn it into an unrelated architectural rewrite; record larger cleanup candidates for a separate optimization phase after behavior is stable.
- A periodic deep optimization pass complements this closeout step but never replaces it.

## Independent Analysis Engines
- Read `B_C_ENGINE_EXPERIMENT_SUMMARY.md` before proposing or training a successor to the production signal engine. Treat it as experiment history and negative evidence, never as a source of training labels or signal decisions.
- Reuse factual inputs, date alignment, generic indicator math, cache transport, evaluation utilities, and rendering contracts where their semantics are identical.
- An engine requested as independent MUST NOT import, invoke, clone, post-process, or use as a fallback another engine's decisions, scores, thresholds, policies, signal families, or emitted markers.
- Keep champion/challenger comparison outside both engines. Tests must prove the candidate output is unchanged when champion output is injected, removed, or altered.
- Freeze candidate rules and parameters before evaluating unseen dates or audit tickers. A named target date may be inspected only after the frozen evaluation and MUST NOT be used to tune that candidate.
- Do not promote or delete the current runtime until the independent candidate passes the predeclared quality, stability, signal-density, and point-in-time gates. A failed candidate remains research-only.

## Chart And Interaction Invariants
- Use these stable product names in discussion and implementation: chart 1 is the main rendering pane, chart 2 is the technical auxiliary rendering pane, and chart 3 is the macro auxiliary rendering pane.
- The main viewport is the authoritative owner of the visible time range. Linked auxiliary charts consume the same committed range and MUST NOT maintain an independent equivalent range.
- Apply a viewport action's X range, automatic Y fit, handles, overlays, dated markers, and linked-chart ranges through one coordinated update path.
- Dated overlays derive their position from the owning series and date. They MUST NOT persist or independently estimate coordinates already defined by that series.
- Pointer, wheel, pinch, resize, and drag input coalesce to the latest animation frame. Perform no more than one necessary reconciliation after the interaction settles.
- Desktop and touch adapters use the same viewport state transition whenever their semantics match.
- Chart 2 technical indicators use one registry-backed trace, toggle, axis-fit, and viewport-sync contract. Adding an indicator MUST extend that registry rather than add another interaction or synchronization path.

## Deployment
- `.github/workflows/deploy-pages.yml` is the only deployment workflow and is manual-only.
- `deploy_pages.bat` is the single local release entry point.
- The workflow must upload the prepared Pages artifact, not an alternate product surface.
- The local app version is authoritative. Increment it once when local feature work begins, then keep that same version while fixing any validation or deployment defects before redeploying.
