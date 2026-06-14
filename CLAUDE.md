# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Commands

- **Start Dev Server**: 
pm run dev (Starts both web and API with concurrently. App runs on fixed port 5173).
- **Run Unit Tests**: 
pm run test (Runs Vitest).
- **Run Single Test**: 
px vitest run <path-to-test-file>
- **Run Coverage**: 
pm run test:coverage
- **Run E2E Tests**: 
pm run test:e2e (Playwright tests).
- **Lint**: 
pm run lint
- **Typecheck**: 
pm run typecheck
- **Format Check**: 
pm run format:check
- **Build**: 
pm run build

*Note: Monorepo uses npm workspaces (pps/web, pps/api, packages/contracts). Use --workspace <name> to scope commands if needed.*

## Project Architecture & Structure

"Xiaohua" (笑画) is a voice-first, layered AI drawing tool designed to run completely offline/locally in mainland China without depending on external cloud services.

### High-Level Architecture
- **Web App (pps/web/)**: React + TypeScript + Vite. 
  - **Rendering**: Uses Konva / eact-konva for layered object rendering and manipulation instead of raw Canvas DOM.
  - **State**: zustand manages project state, selection, and command queues. Domain commands should be isolated in independent store/actions for testability.
- **Local API (pps/api/)**: Node.js + Express. Exposes endpoints for local Whisper ASR recognition, LLM command parsing, and Stable Diffusion WebUI rendering. Uses the Adapter pattern to abstract actual provider implementations.
- **Contracts (packages/contracts/)**: Shared Zod Schemas and TypeScript definitions for cross-application communication (API limits, data models, payloads).

### Core Concepts & Domain Logic
- **Voice-First Philosophy**: Primary user flows (create, select, modify, destroy, save) must be possible using pure voice commands and edge VAD turn-taking. Mouse/keyboard are strictly fallbacks/developer tools.
- **Objects as Independent Layers**: Visual elements must be independent layered objects containing stable IDs, transform data (opacity, scale, rotation, layer index), and original generation metadata (prompts). Changing an object should strictly manipulate that object's properties or re-render only that object. **Do not perform full-image regenerations for single object operations.**
- **Structured Command Pipeline**: Natural language input never affects the canvas directly. The pipeline strictly enforces: NLP -> Structured parsed commands -> Zod Validation -> Safelisted Action Check -> Target resolution -> Atomic State Execution. Ambiguous intent or low confidence resolutions must halt for confirmation.
- **Graceful Degradation**: External API failures (like Stable Diffusion timeouts) must invoke fallback routines without breaking the user state. Implement limited retries, fallback to cached assets, preset default components, or simple primitive shapes. 
- **Domain Constraints**:
  - Provide domain logic vs UI decoupling.
  - Ensure all User-facing UI elements and error messages (with recovery steps) are in Chinese.
  - Core pipelines (command parsing, state changes, project exports) require automated test coverage.
