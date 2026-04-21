# DayDream Headless SillyTavern Plan

## Goal

Build a product architecture where:

- DayDream owns the entire user-facing experience.
- SillyTavern becomes a hidden orchestration backend.
- DayDream no longer calls upstream model providers directly.
- DayDream generation first enters a reusable SillyTavern prompt assembly pipeline, then uses existing SillyTavern backend provider adapters.

In one sentence:

**DayDream takes over the frontend, SillyTavern moves behind the curtain.**

## Product Outcome

If this plan is completed, DayDream can keep its custom mobile-style UI while gaining controlled access to SillyTavern-native capabilities such as:

- character card fields
- chat history persistence
- world info / lorebook injection
- Author's Note
- system prompt
- instruct mode
- provider presets and user settings
- model routing and provider-specific adapters
- some extension prompt injection behavior

The user should not need to see the native SillyTavern UI.

## Current State

### What DayDream already has

- A standalone public page at `/daydream` served by [src/server-main.js](./src/server-main.js:217)
- A custom frontend in [public/daydream.html](./public/daydream.html:19), [public/scripts/daydream-public.js](./public/scripts/daydream-public.js:182), and [public/scripts/daydream-public.css](./public/scripts/daydream-public.css:1)
- A custom backend endpoint in [src/endpoints/daydream.js](./src/endpoints/daydream.js:215)
- A complete DayDream-specific gameplay layer:
  - story selection
  - state tracking
  - option parsing
  - `DAYDREAM_META` parsing
  - top stats and bottom tabs from [public/scripts/extensions/third-party/daydream/data/ui-profiles.json](./public/scripts/extensions/third-party/daydream/data/ui-profiles.json:3)

### What SillyTavern already has

- persistent characters: [src/endpoints/characters.js](./src/endpoints/characters.js:1012)
- persistent chats: [src/endpoints/chats.js](./src/endpoints/chats.js:433)
- persistent world info books: [src/endpoints/worldinfo.js](./src/endpoints/worldinfo.js:37)
- user settings and presets: [src/endpoints/settings.js](./src/endpoints/settings.js:204)
- provider routing for chat completions: [src/endpoints/backends/chat-completions.js](./src/endpoints/backends/chat-completions.js:2016)
- frontend prompt assembly entrypoint: [public/script.js](./public/script.js:4207)
- OpenAI-style prompt assembly for chat completions: [public/scripts/openai.js](./public/scripts/openai.js:1513)
- world info assembly: [public/scripts/world-info.js](./public/scripts/world-info.js:892)
- Author's Note injection: [public/scripts/authors-note.js](./public/scripts/authors-note.js:324)

## Critical Constraint

The biggest architectural constraint is:

**Many SillyTavern "native capabilities" are not currently exposed as a clean server-side headless API.**

Today, much of the orchestration happens in the browser before generation:

- `Generate()` in [public/script.js](./public/script.js:4207)
- `prepareOpenAIMessages()` in [public/scripts/openai.js](./public/scripts/openai.js:1513)
- `getWorldInfoPrompt()` in [public/scripts/world-info.js](./public/scripts/world-info.js:892)
- `setFloatingPrompt()` in [public/scripts/authors-note.js](./public/scripts/authors-note.js:324)
- extension prompt collection via [public/script.js](./public/script.js:8817)

This means the target architecture is achievable, but not by simply changing one endpoint URL.

## Recommended Strategy

### Decision

Do **not** rebuild DayDream orchestration from scratch.

Do **not** try to make the DayDream public page emulate the full native SillyTavern frontend.

Instead:

1. Extract or wrap the reusable SillyTavern prompt assembly logic into a new shared orchestration layer.
2. Keep DayDream's current public UI as the only user-facing application.
3. Make the DayDream backend call the shared orchestration layer.
4. Reuse existing SillyTavern backend provider adapters for the final upstream request.

### Design Principle

Use existing SillyTavern code in this order:

- reuse directly
- wrap
- extract to a shared module
- only rewrite when extraction is impossible or too risky

## Reuse Matrix

### Reuse directly

These can be reused with minimal change:

- provider adapters in [src/endpoints/backends/chat-completions.js](./src/endpoints/backends/chat-completions.js:2016)
- persistent storage formats for characters, chats, settings, and world info
- server routes and server boot chain in [src/server-main.js](./src/server-main.js:1) and [src/server-startup.js](./src/server-startup.js:141)
- DayDream's current custom frontend and state model

### Reuse by wrapping

These should be wrapped behind a DayDream server-facing orchestration API:

- character loading and selection
- chat loading and saving
- settings loading
- provider preset selection
- world info selection

### Reuse by extraction into shared modules

These are the high-value pieces that should be moved out of the browser-only generation path:

- character field assembly from [public/script.js](./public/script.js:3397)
- world info prompt building from [public/scripts/world-info.js](./public/scripts/world-info.js:892)
- Author's Note insertion behavior from [public/scripts/authors-note.js](./public/scripts/authors-note.js:324)
- extension prompt accumulation from [public/script.js](./public/script.js:8817)
- OpenAI/chat completion prompt assembly from [public/scripts/openai.js](./public/scripts/openai.js:1513)

### Defer for later

These should not block v1:

- full slash command support
- arbitrary extension UI compatibility
- full macro parity with the native frontend
- full PromptManager UI parity
- every edge case inside native chat editing features

## What We Can Deliver in V1

### V1 supported capabilities

- custom DayDream public UI only
- SillyTavern-backed model generation
- character card fields
- chat history persistence in SillyTavern chat format
- world info activation and prompt injection
- Author's Note injection
- system prompt override support
- instruct mode support where applicable
- selected provider preset and settings support
- streaming back to DayDream UI

### V1 intentionally limited

- slash commands only for internal/admin or disabled entirely
- extension prompt support only for explicitly supported modules
- macro support only where already covered by reused prompt assembly functions

## Target Architecture

### User-facing flow

1. User opens `/daydream`
2. User selects story / role / action from DayDream UI
3. DayDream frontend sends a structured generation request to `/api/daydream/generate`
4. DayDream backend loads or creates a SillyTavern-backed session context
5. Shared orchestration layer assembles the final prompt using SillyTavern rules
6. Existing SillyTavern provider adapter sends the request upstream
7. Streamed response is returned to DayDream frontend
8. DayDream parses `DAYDREAM_META`, updates state, and optionally persists chat metadata

### Internal architecture

- `public/daydream.html` and `public/scripts/daydream-public.js` remain the frontend
- `src/endpoints/daydream.js` becomes an orchestration entrypoint instead of a direct provider proxy
- new shared server-side orchestration modules are introduced under a new folder, recommended:
  - `src/daydream-st/`

Recommended new modules:

- `src/daydream-st/session-store.js`
- `src/daydream-st/context-loader.js`
- `src/daydream-st/orchestration.js`
- `src/daydream-st/prompt-assembly.js`
- `src/daydream-st/provider-dispatch.js`

## Proposed Server-Side Session Model

Each DayDream run should map to a SillyTavern-compatible session context.

### Minimum session fields

- `session_id`
- `story_id`
- `character_avatar` or internal character key
- `chat_name`
- `chat_metadata`
- `selected_world_info`
- `author_note_config`
- `system_prompt_override`
- `preset_identity`
- `provider_source`

### Recommendation

Do not keep DayDream as localStorage-only state forever.

Instead:

- Keep UI responsiveness in local state if needed.
- Persist canonical state on the server in SillyTavern-compatible storage.

This allows DayDream to use:

- native chat persistence
- native world info bindings
- server-side recovery
- future multi-device continuation

## Development Plan

## Phase 0: Confirm Scope

### Deliverable

A frozen implementation scope for v1.

### Decisions to lock

- DayDream keeps its current standalone UI
- SillyTavern native UI is not exposed to end users
- v1 supports character card, chat history, world info, Author's Note, system prompt, instruct mode, presets
- v1 does not promise full slash-command parity

### Acceptance criteria

- Scope is documented and agreed
- No requirement to support arbitrary native frontend controls in v1

## Phase 1: Create a Headless DayDream Session Layer

### Goal

Introduce a server-side DayDream session model that can reference SillyTavern characters, chats, and metadata.

### Tasks

- Extend [src/endpoints/daydream.js](./src/endpoints/daydream.js:215) with session-oriented APIs:
  - `POST /api/daydream/session/create`
  - `POST /api/daydream/session/load`
  - `POST /api/daydream/session/save`
- Define a canonical DayDream session record
- Map a DayDream session to:
  - one ST character
  - one ST chat
  - one ST chat metadata object

### Reuse target

- reuse chat format from [src/endpoints/chats.js](./src/endpoints/chats.js:470)
- reuse character storage from [src/endpoints/characters.js](./src/endpoints/characters.js:1318)

### Acceptance criteria

- A DayDream session can be created and resumed on the server
- Session data survives page refresh
- A session can be linked to a SillyTavern chat file

## Phase 2: Build a Shared Context Loader

### Goal

Load all generation inputs from server-side state rather than browser-only globals.

### Tasks

- Create `src/daydream-st/context-loader.js`
- Load:
  - character card fields
  - chat history
  - chat metadata
  - selected world info
  - settings and preset data
- Mirror the minimum outputs of:
  - [public/script.js](./public/script.js:3397)
  - [public/script.js](./public/script.js:7558)

### Important rule

Do not call local HTTP endpoints from the same server process if importing internal modules is practical.

Prefer internal module reuse and data format compatibility over loopback HTTP requests.

### Acceptance criteria

- Server can reconstruct the same core context that the native frontend normally uses before generation

## Phase 3: Extract Prompt Assembly into a Shared Module

### Goal

Move the prompt-building logic into reusable server-side code.

### Tasks

- Create `src/daydream-st/prompt-assembly.js`
- Extract or port the smallest possible subset of logic from:
  - [public/script.js](./public/script.js:4207)
  - [public/scripts/openai.js](./public/scripts/openai.js:1513)
  - [public/scripts/world-info.js](./public/scripts/world-info.js:892)
  - [public/scripts/authors-note.js](./public/scripts/authors-note.js:324)
- Keep the API narrow:
  - input: DayDream session context + generation request
  - output: final prompt/messages + provider settings

### Reuse strategy

- Preserve SillyTavern prompt behavior as much as possible
- Avoid inventing a second prompt DSL
- Prefer function extraction over behavioral reimplementation

### Acceptance criteria

- DayDream can produce prompt payloads that match SillyTavern behavior closely enough for the same character/setup
- World info and Author's Note are visibly affecting output

## Phase 4: Reuse Existing Provider Dispatch

### Goal

Once prompt assembly is complete, route the request through existing SillyTavern provider adapters.

### Tasks

- Add `src/daydream-st/provider-dispatch.js`
- Reuse [src/endpoints/backends/chat-completions.js](./src/endpoints/backends/chat-completions.js:2016) for final upstream dispatch
- Avoid direct raw fetch calls to upstream providers from `daydream.js`
- Preserve streaming behavior

### Acceptance criteria

- DayDream uses the same provider routing path as SillyTavern chat completions
- Changing provider presets changes DayDream behavior without separate provider code

## Phase 5: Connect DayDream Public API to the Shared Orchestrator

### Goal

Replace the current direct DayDream provider proxy with the new orchestration backend.

### Tasks

- Refactor [src/endpoints/daydream.js](./src/endpoints/daydream.js:215)
- Current endpoint responsibilities should become:
  - resolve session
  - assemble DayDream gameplay context
  - call shared orchestration
  - stream response

### Preserve

- existing `bootstrap` API shape where practical
- existing DayDream frontend streaming UX
- existing DayDream `DAYDREAM_META` contract

### Acceptance criteria

- DayDream frontend does not need major UX changes
- Backend request path no longer directly calls upstream `/chat/completions`

## Phase 6: Persist DayDream + ST Combined Metadata

### Goal

Save enough metadata to make sessions resumable and lore-aware.

### Tasks

- Persist DayDream gameplay state in chat metadata
- Persist session bindings to selected world info and prompts
- Keep compatibility with SillyTavern save/load flow where possible

Suggested metadata keys:

- `daydream.state`
- `daydream.story`
- `daydream.ui_profile`
- `daydream.system`

### Acceptance criteria

- Reloading a DayDream session restores both gameplay state and ST orchestration state

## Phase 7: Optional Advanced Features

### Candidate features

- internal GM tools
- admin-only slash command bridge
- limited macro support
- custom story -> ST character generation pipeline
- one-click world info binding per story

### Rule

Do not block v1 on these.

## What Not To Do

- Do not rewrite a second provider adapter stack.
- Do not rebuild ST's character/chat/world info storage formats.
- Do not force users into the native SillyTavern frontend.
- Do not attempt full native extension parity before the shared orchestration layer exists.
- Do not make DayDream depend on browser globals from `public/script.js` in production.

## Recommended File Changes

### New files

- `src/daydream-st/session-store.js`
- `src/daydream-st/context-loader.js`
- `src/daydream-st/prompt-assembly.js`
- `src/daydream-st/orchestration.js`
- `src/daydream-st/provider-dispatch.js`

### Existing files to modify

- [src/endpoints/daydream.js](./src/endpoints/daydream.js:215)
- [src/server-main.js](./src/server-main.js:242) only if new public session endpoints are added

### Source files to mine for reusable logic

- [public/script.js](./public/script.js:3397)
- [public/script.js](./public/script.js:4207)
- [public/scripts/openai.js](./public/scripts/openai.js:1513)
- [public/scripts/world-info.js](./public/scripts/world-info.js:892)
- [public/scripts/authors-note.js](./public/scripts/authors-note.js:324)
- [src/endpoints/backends/chat-completions.js](./src/endpoints/backends/chat-completions.js:2016)

## Capability Table

| Capability | V1 status | Reuse mode | Notes |
| --- | --- | --- | --- |
| Character card fields | Yes | reuse/extract | Requires server-side context loader |
| Chat history | Yes | reuse | Use native ST chat format and persistence |
| World Info | Yes | extract | High-value feature, should be in v1 |
| Author's Note | Yes | extract | Tie to chat metadata |
| System Prompt | Yes | reuse/extract | Support override path |
| Instruct Mode | Yes | reuse/extract | Important for non-OpenAI style flows |
| Provider presets | Yes | reuse | Use existing settings/preset data |
| User setting transforms | Mostly | reuse/extract | Depends on assembled prompt path |
| Extension prompt injection | Partial | extract | Support only required modules in v1 |
| Macros | Partial | defer | Only where already covered naturally |
| Slash commands | No for end users | defer | Admin/debug only after v1 |

## Risks

### Risk 1: Browser-only assumptions

Large parts of native orchestration assume frontend globals:

- `chat`
- `chat_metadata`
- `this_chid`
- DOM state
- selected provider state

Mitigation:

- build a server-side context object with the minimum compatible shape
- isolate browser-only code paths during extraction

### Risk 2: Too much extraction at once

If we try to port the entire native frontend generation stack in one shot, the project will slow down badly.

Mitigation:

- implement only the subset DayDream needs for v1
- keep a strict supported capability matrix

### Risk 3: Public endpoint abuse

DayDream public routes currently sit before auth in [src/server-main.js](./src/server-main.js:242).

Mitigation:

- add rate limiting
- add session control
- optionally require public access tokens or anonymous quotas

## Acceptance Criteria for the Whole Project

The project is successful when all of the following are true:

1. Users interact only with DayDream UI.
2. DayDream no longer calls upstream model providers directly.
3. A DayDream run can use ST-backed character card data.
4. A DayDream run can use ST-backed chat history.
5. A DayDream run can activate ST world info.
6. A DayDream run can apply ST Author's Note and system prompt logic.
7. Provider selection and preset changes affect DayDream without separate provider code.
8. Streaming still works in the public DayDream page.
9. The implementation reuses existing ST modules wherever practical instead of recreating them.

## Recommended Execution Order

If development starts now, the safest order is:

1. session model
2. context loader
3. prompt assembly extraction
4. provider dispatch reuse
5. endpoint refactor
6. metadata persistence
7. optional advanced features

## Final Recommendation

This goal is realistic.

The correct implementation path is:

- keep DayDream UI
- stop direct upstream model calls from DayDream
- extract a headless SillyTavern orchestration core
- reuse existing SillyTavern provider dispatch and storage formats

This gives the best balance of:

- product quality
- code reuse
- long-term maintainability
- minimum duplicated infrastructure
