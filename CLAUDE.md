# Gemini Image MCP Server

## Language

**Always use English** for all communication, code, comments, commit messages, and documentation.

## Project Overview

MCP (Model Context Protocol) server that provides image generation and editing tools via Google Gemini API. Designed as a Claude Code plugin for generating illustrations, icons, and visual assets.

## Tech Stack

- **Runtime**: Node.js with TypeScript (ES2022, Node16 modules)
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **AI**: `@google/genai` (Google Gemini API)
- **Image processing**: `sharp`, `@imgly/background-removal-node`
- **Validation**: `zod`

## Project Structure

```
src/index.ts    — Main server with all MCP tools
build/          — Compiled JS output (gitignored)
```

## Build & Run

```bash
npm install
npm run build       # tsc → build/
npm start           # node build/index.js
```

## MCP Tools

- `generate_image` — Text prompt → image file
- `edit_image` — Source image + prompt → edited image
- `remove_background` — Remove image background (ML segmentation by default, Gemini or threshold as fallbacks)

## Key Conventions

- Model used: `gemini-3-pro-image-preview`
- Images saved to `IMAGE_OUTPUT_DIR` (default: `./generated_images`)
- All tool responses return file paths, not inline data
- Errors are returned as MCP error responses, never thrown
