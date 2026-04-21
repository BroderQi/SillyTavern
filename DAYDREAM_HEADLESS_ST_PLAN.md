# DayDreamer Headless SillyTavern Plan

## Goal

Build a product architecture where:

- DayDreamer owns the entire user-facing experience.
- SillyTavern becomes a hidden orchestration backend.
- DayDreamer no longer calls upstream model providers directly.
- DayDreamer generation first enters a reusable SillyTavern prompt assembly pipeline, then uses existing SillyTavern backend provider adapters.

In one sentence:

**DayDreamer takes over the frontend, SillyTavern moves behind the curtain.**

## Product Outcome

If this plan is completed, DayDreamer can keep its custom mobile-style UI while gaining controlled access to SillyTavern-native capabilities such as:

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

### What DayDreamer already has

- A standalone public page at `/DayDreamer` served by [src/server-main.js](./src/server-main.js:217)
- A custom frontend in [public/DayDreamer.html](./public/DayDreamer.html:19), [public/scripts/DayDreamer-public.js](./public/scripts/DayDreamer-public.js:182), and [public/scripts/DayDreamer-public.css](./public/scripts/DayDreamer-public.css:1)
- A custom backend endpoint in [src/endpoints/DayDreamer.js](./src/endpoints/DayDreamer.js:215)
- A complete DayDreamer-specific gameplay layer:
  - story selection
  - state tracking
  - option parsing
  - `DayDreamer_META` parsing
  - top stats and bottom tabs from [public/scripts/extensions/third-party/DayDreamer/data/ui-profiles.json](./public/scripts/extensions/third-party/DayDreamer/data/ui-profiles.json:3)

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

Do **not** rebuild DayDreamer orchestration from scratch.

Do **not** try to make the DayDreamer public page emulate the full native SillyTavern frontend.

Instead:

1. Extract or wrap the reusable SillyTavern prompt assembly logic into a new shared orchestration layer.
2. Keep DayDreamer's current public UI as the only user-facing application.
3. Make the DayDreamer backend call the shared orchestration layer.
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
- DayDreamer's current custom frontend and state model

### Reuse by wrapping

These should be wrapped behind a DayDreamer server-facing orchestration API:

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

- custom DayDreamer public UI only
- SillyTavern-backed model generation
- DayDreamer-native people/relationship cards, editable by the user
- DayDreamer-native editable world book entries generated from `DayDreamer_META`
- lightweight session state persistence, without full chat transcript persistence
- hidden Author's Note injection
- hidden system prompt support
- instruct mode support where applicable
- hidden provider preset and settings support
- streaming back to DayDreamer UI

### V1 intentionally limited

- full chat history persistence is disabled in v1 to avoid memory/storage growth
- ST role card, chat, world info, Author's Note, system prompt, and provider controls are not exposed in the DayDreamer UI
- slash commands only for internal/admin or disabled entirely
- extension prompt support only for explicitly supported modules
- macro support only where already covered by reused prompt assembly functions

### Product UI Scope

DayDreamer exposes only product-level controls:

- People: the relationship/person tab acts as DayDreamer's user-facing character card layer. Users can add, edit, and delete people.
- World book: DayDreamer can generate durable world entries through `DayDreamer_META.world_entries`; users can add, edit, delete, enable, and disable entries.
- Settings: only DayDreamer actions are visible, such as restarting, ending, or clearing local state.

DayDreamer hides backend mechanics:

- full chat logs
- ST chat selection
- ST world info selection
- Author's Note
- system prompt
- provider/model routing
- prompt assembly
- extension prompt injection

## Target Architecture

### User-facing flow

1. User opens `/DayDreamer`
2. User selects story / role / action from DayDreamer UI
3. DayDreamer frontend sends a structured generation request to `/api/DayDreamer/generate`
4. DayDreamer backend loads or creates a SillyTavern-backed session context
5. Shared orchestration layer assembles the final prompt using SillyTavern rules
6. Existing SillyTavern provider adapter sends the request upstream
7. Streamed response is returned to DayDreamer frontend
8. DayDreamer parses `DayDreamer_META`, updates state, and optionally persists chat metadata

### Internal architecture

- `public/DayDreamer.html` and `public/scripts/DayDreamer-public.js` remain the frontend
- `src/endpoints/DayDreamer.js` becomes an orchestration entrypoint instead of a direct provider proxy
- new shared server-side orchestration modules are introduced under a new folder, recommended:
  - `src/DayDreamer-st/`

Recommended new modules:

- `src/DayDreamer-st/session-store.js`
- `src/DayDreamer-st/context-loader.js`
- `src/DayDreamer-st/orchestration.js`
- `src/DayDreamer-st/prompt-assembly.js`
- `src/DayDreamer-st/provider-dispatch.js`

## Proposed Server-Side Session Model

Each DayDreamer run should map to a SillyTavern-compatible session context.

### Minimum session fields

- `session_id`
- `story_id`
- DayDreamer people records
- `chat_metadata`
- DayDreamer world book entries
- hidden orchestration summary, when needed

### Recommendation

Do not keep DayDreamer as localStorage-only state forever.

Instead:

- Keep UI responsiveness in local state if needed.
- Persist canonical state on the server in SillyTavern-compatible storage.

This allows DayDreamer to use:

- resumable lightweight state
- editable people and world book data
- server-side recovery
- future multi-device continuation

## Development Plan

## Phase 0: Confirm Scope

### Deliverable

A frozen implementation scope for v1.

### Decisions to lock

- DayDreamer keeps its current standalone UI
- SillyTavern native UI is not exposed to end users
- v1 exposes DayDreamer people and world book editing
- v1 hides chat history, Author's Note, system prompt, model routing, prompt assembly, and extension injection
- v1 does not save full chat transcripts
- v1 does not promise full slash-command parity

### Acceptance criteria

- Scope is documented and agreed
- No requirement to support arbitrary native frontend controls in v1

## Phase 1: Create a Headless DayDreamer Session Layer

### Goal

Introduce a server-side DayDreamer session model that can reference SillyTavern characters, chats, and metadata.

### Tasks

- Extend [src/endpoints/DayDreamer.js](./src/endpoints/DayDreamer.js:215) with session-oriented APIs:
  - `POST /api/DayDreamer/session/create`
  - `POST /api/DayDreamer/session/load`
  - `POST /api/DayDreamer/session/save`
- Define a canonical DayDreamer session record
- Map a DayDreamer session to:
  - one ST character
  - one ST chat
  - one ST chat metadata object

### Reuse target

- reuse chat format from [src/endpoints/chats.js](./src/endpoints/chats.js:470)
- reuse character storage from [src/endpoints/characters.js](./src/endpoints/characters.js:1318)

### Acceptance criteria

- A DayDreamer session can be created and resumed on the server
- Session data survives page refresh
- A session can be linked to a SillyTavern chat file

## Phase 2: Build a Shared Context Loader

### Goal

Load all generation inputs from server-side state rather than browser-only globals.

### Tasks

- Create `src/DayDreamer-st/context-loader.js`
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

- Create `src/DayDreamer-st/prompt-assembly.js`
- Extract or port the smallest possible subset of logic from:
  - [public/script.js](./public/script.js:4207)
  - [public/scripts/openai.js](./public/scripts/openai.js:1513)
  - [public/scripts/world-info.js](./public/scripts/world-info.js:892)
  - [public/scripts/authors-note.js](./public/scripts/authors-note.js:324)
- Keep the API narrow:
  - input: DayDreamer session context + generation request
  - output: final prompt/messages + provider settings

### Reuse strategy

- Preserve SillyTavern prompt behavior as much as possible
- Avoid inventing a second prompt DSL
- Prefer function extraction over behavioral reimplementation

### Acceptance criteria

- DayDreamer can produce prompt payloads that match SillyTavern behavior closely enough for the same character/setup
- World info and Author's Note are visibly affecting output

## Phase 4: Reuse Existing Provider Dispatch

### Goal

Once prompt assembly is complete, route the request through existing SillyTavern provider adapters.

### Tasks

- Add `src/DayDreamer-st/provider-dispatch.js`
- Reuse [src/endpoints/backends/chat-completions.js](./src/endpoints/backends/chat-completions.js:2016) for final upstream dispatch
- Avoid direct raw fetch calls to upstream providers from `DayDreamer.js`
- Preserve streaming behavior

### Acceptance criteria

- DayDreamer uses the same provider routing path as SillyTavern chat completions
- Changing provider presets changes DayDreamer behavior without separate provider code

## Phase 5: Connect DayDreamer Public API to the Shared Orchestrator

### Goal

Replace the current direct DayDreamer provider proxy with the new orchestration backend.

### Tasks

- Refactor [src/endpoints/DayDreamer.js](./src/endpoints/DayDreamer.js:215)
- Current endpoint responsibilities should become:
  - resolve session
  - assemble DayDreamer gameplay context
  - call shared orchestration
  - stream response

### Preserve

- existing `bootstrap` API shape where practical
- existing DayDreamer frontend streaming UX
- existing DayDreamer `DayDreamer_META` contract

### Acceptance criteria

- DayDreamer frontend does not need major UX changes
- Backend request path no longer directly calls upstream `/chat/completions`

## Phase 6: Persist Lightweight DayDreamer Metadata

### Goal

Save enough metadata to make sessions resumable and lore-aware without storing full chat transcripts.

### Tasks

- Persist DayDreamer gameplay state in the DayDreamer session record
- Persist user-editable people records
- Persist user-editable world book entries
- Do not persist complete user/assistant chat history in v1

Suggested metadata keys:

- `DayDreamer.state`
- `DayDreamer.story`
- `DayDreamer.ui_profile`
- `DayDreamer.system`

### Acceptance criteria

- Reloading a DayDreamer session restores story state, people, world book entries, resources, events, and visible stats
- No ST chat transcript is created or appended during normal DayDreamer generation

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
- Do not make DayDreamer depend on browser globals from `public/script.js` in production.

## Recommended File Changes

### New files

- `src/DayDreamer-st/session-store.js`
- `src/DayDreamer-st/context-loader.js`
- `src/DayDreamer-st/prompt-assembly.js`
- `src/DayDreamer-st/orchestration.js`
- `src/DayDreamer-st/provider-dispatch.js`

### Existing files to modify

- [src/endpoints/DayDreamer.js](./src/endpoints/DayDreamer.js:215)
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
| DayDreamer people cards | Yes | DayDreamer-native | User-facing character/relationship layer with add/edit/delete |
| ST character card fields | Hidden/optional | reuse/extract | Backend-only; do not expose native ST UI in v1 |
| Chat history | No | defer | Do not save full transcripts in v1 |
| DayDreamer world book | Yes | DayDreamer-native | Generated via `world_entries`, user-editable |
| ST World Info | Hidden/optional | extract | Backend-only if explicitly bound later |
| Author's Note | Hidden | extract | Internal control only |
| System Prompt | Hidden | reuse/extract | Internal control only |
| Instruct Mode | Yes | reuse/extract | Important for non-OpenAI style flows |
| Provider presets | Hidden | reuse | Service-owned routing; no user-facing model controls |
| User setting transforms | Mostly | reuse/extract | Depends on assembled prompt path |
| Extension prompt injection | Hidden/partial | extract | Support only required modules in v1 |
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

- implement only the subset DayDreamer needs for v1
- keep a strict supported capability matrix

### Risk 3: Public endpoint abuse

DayDreamer public routes currently sit before auth in [src/server-main.js](./src/server-main.js:242).

Mitigation:

- add rate limiting
- add session control
- optionally require public access tokens or anonymous quotas

## Acceptance Criteria for the Whole Project

The project is successful when all of the following are true:

1. Users interact only with DayDreamer UI.
2. DayDreamer no longer calls upstream model providers directly.
3. Users can add, edit, and delete DayDreamer people records.
4. Users can add, edit, delete, enable, and disable DayDreamer world book entries.
5. DayDreamer does not save full chat transcripts during normal generation.
6. DayDreamer can apply hidden Author's Note and system prompt logic.
7. Provider routing is service-owned and hidden from users.
8. Streaming still works in the public DayDreamer page.
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

- keep DayDreamer UI
- stop direct upstream model calls from DayDreamer
- extract a headless SillyTavern orchestration core
- reuse existing SillyTavern provider dispatch and storage formats

This gives the best balance of:

- product quality
- code reuse
- long-term maintainability
- minimum duplicated infrastructure
