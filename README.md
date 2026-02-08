# MCP Gemini Image — Image Generation for Claude Code

MCP server for generating and editing images via Google Gemini API.
Works as a Claude Code plugin — the agent gets tools for creating illustrations directly in the project context.

## Tools

| Tool | Description |
|---|---|
| `generate_image` | Text → Image. Generate from a text prompt |
| `edit_image` | Image + Text → Image. Edit/stylize an existing image |
| `remove_background` | Remove background. Methods: `ml` (local AI segmentation, default), `gemini`, `threshold` |

## Cost

- **Gemini 3 Pro Image Preview** (`gemini-3-pro-image-preview`): ~$0.134 / image
- With ~$290 credits ≈ **2,100 images**

## Setup

### 1. Clone / copy the project

```bash
cd ~/Developer/gemini-mcp
```

### 2. Install dependencies and build

```bash
npm install
npm run build
```

### 3. Get an API key

- Go to https://aistudio.google.com/apikey
- Create a key for your project
- Make sure Gemini API is enabled

### 4. Connect to Claude Code

```bash
claude mcp add gemini-image \
  --scope user \
  -- node ~/Developer/gemini-mcp/build/index.js
```

Then add the API key to the config. Open `~/.claude.json` and add env to the server configuration:

```json
{
  "mcpServers": {
    "gemini-image": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/yuraist/Developer/gemini-mcp/build/index.js"],
      "env": {
        "GEMINI_API_KEY": "AIza...",
        "IMAGE_OUTPUT_DIR": "/Users/yuraist/Developer/gemini-mcp/output"
      }
    }
  }
}
```

### 5. Verify

Restart Claude Code and ask:
> "What image tools do you have?"

The agent should see `generate_image`, `edit_image`, and `remove_background`.

## Usage Examples

### Generate illustrations

Example prompt for Claude Code:
> "Analyze the onboarding screens. For each screen, suggest an illustration concept in a flat minimal style with pastel colors. Describe your idea, and after my approval, generate the images."

### Iterative refinement

> "Take the generated image /path/to/image.png and make the character friendlier, add soft shadows."

### Style transfer from reference

> "Here's a reference illustration [path]. Generate a set of illustrations in the same style for screens: Welcome, Features, Get Started."

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key | required |
| `IMAGE_OUTPUT_DIR` | Directory for saving generated images | `./generated_images` |

## Notes

- **Transparency**: Gemini doesn't generate with transparent backgrounds. Use `remove_background` (default `ml` method) after generation — it uses a local U2Net segmentation model for high-quality results. First run downloads model weights (~30 MB), subsequent runs are fast.
- **Iterations**: Feed the previous result through `edit_image` with new instructions.
- **Size**: Supports up to 4K resolution. For different aspect ratios, add "landscape" / "portrait" to the prompt.
- **Rate limits**: Paid tier 1 = 500 RPM. More than enough for most projects.
