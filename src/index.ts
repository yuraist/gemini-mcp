#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";

// --- Config ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || path.join(process.cwd(), "generated_images");

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Ensure output directory exists
async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

// Save image from base64 response
async function saveImage(base64Data: string, mimeType: string, filename: string): Promise<string> {
  await ensureOutputDir();
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const filepath = path.join(OUTPUT_DIR, `${filename}.${ext}`);
  const buffer = Buffer.from(base64Data, "base64");
  await fs.writeFile(filepath, buffer);
  return filepath;
}

// Generate unique filename
function makeFilename(prefix: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${prefix}_${ts}`;
}

// --- MCP Server ---
const server = new McpServer({
  name: "gemini-image",
  version: "1.0.0",
});

// Tool 1: Generate image from text
server.tool(
  "generate_image",
  "Generate an image from a text prompt using Gemini 3 Pro Image Preview. Returns the file path of the generated image.",
  {
    prompt: z.string().describe("Detailed description of the image to generate. Be specific about style, composition, colors, mood."),
    output_filename: z.string().optional().describe("Optional custom filename (without extension). Defaults to auto-generated name."),
  },
  async ({ prompt, output_filename }) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-pro-image-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      const savedFiles: string[] = [];
      let textResponse = "";

      for (const part of parts) {
        if (part.text) {
          textResponse += part.text;
        }
        if (part.inlineData) {
          const filename = output_filename || makeFilename("gen");
          const filepath = await saveImage(
            part.inlineData.data!,
            part.inlineData.mimeType!,
            filename + (savedFiles.length > 0 ? `_${savedFiles.length}` : "")
          );
          savedFiles.push(filepath);
        }
      }

      if (savedFiles.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No image was generated. Model response: ${textResponse || "empty"}. Try rephrasing the prompt.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ Generated ${savedFiles.length} image(s):\n${savedFiles.map((f) => `  → ${f}`).join("\n")}${textResponse ? `\n\nModel notes: ${textResponse}` : ""}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `❌ Generation failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: Edit/transform an existing image
server.tool(
  "edit_image",
  "Edit or transform an existing image using Gemini 3 Pro Image Preview. Provide a source image and instructions for modification. Great for style transfer, modifications, and img2img workflows.",
  {
    source_image_path: z.string().describe("Absolute path to the source image file."),
    prompt: z.string().describe("Instructions for how to edit/transform the image. E.g., 'Make this illustration in a flat minimal style with pastel colors' or 'Remove the text and add a sunset background'."),
    output_filename: z.string().optional().describe("Optional custom filename (without extension)."),
  },
  async ({ source_image_path, prompt, output_filename }) => {
    try {
      // Read source image
      const imageBuffer = await fs.readFile(source_image_path);
      const base64Image = imageBuffer.toString("base64");

      // Detect mime type from extension
      const ext = path.extname(source_image_path).toLowerCase();
      const mimeType =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "image/jpeg";

      const response = await ai.models.generateContent({
        model: "gemini-3-pro-image-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Image,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        config: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      const savedFiles: string[] = [];
      let textResponse = "";

      for (const part of parts) {
        if (part.text) {
          textResponse += part.text;
        }
        if (part.inlineData) {
          const filename = output_filename || makeFilename("edit");
          const filepath = await saveImage(
            part.inlineData.data!,
            part.inlineData.mimeType!,
            filename + (savedFiles.length > 0 ? `_${savedFiles.length}` : "")
          );
          savedFiles.push(filepath);
        }
      }

      if (savedFiles.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No edited image produced. Model response: ${textResponse || "empty"}. Try different instructions.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ Edited ${savedFiles.length} image(s):\n${savedFiles.map((f) => `  → ${f}`).join("\n")}\nSource: ${source_image_path}${textResponse ? `\n\nModel notes: ${textResponse}` : ""}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `❌ Edit failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: Remove background (using sharp)
server.tool(
  "remove_background",
  "Remove or replace the background of an image, making it transparent (PNG with alpha channel). For best results, use images with clear subject/background separation.",
  {
    source_image_path: z.string().describe("Absolute path to the source image file."),
    method: z
      .enum(["ml", "gemini", "threshold"])
      .default("ml")
      .describe("Method: 'ml' uses local AI segmentation model for best quality (default), 'gemini' asks Gemini to regenerate with transparent bg, 'threshold' uses simple color-based removal (fastest, works offline)."),
    output_filename: z.string().optional().describe("Optional custom filename (without extension). Output is always PNG."),
  },
  async ({ source_image_path, method, output_filename }) => {
    try {
      const filename = output_filename || makeFilename("nobg");
      await ensureOutputDir();
      const outputPath = path.join(OUTPUT_DIR, `${filename}.png`);

      if (method === "ml") {
        // Use @imgly/background-removal-node (local U2Net segmentation)
        const imageBuffer = await fs.readFile(source_image_path);
        const blob = new Blob([imageBuffer], { type: "image/png" });
        const resultBlob = await removeBackground(blob);
        const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

        await sharp(resultBuffer).png().toFile(outputPath);

        return {
          content: [
            { type: "text", text: `✅ Background removed (ML segmentation):\n  → ${outputPath}` },
          ],
        };
      } else if (method === "gemini") {
        // Use Gemini to regenerate with transparent background
        const imageBuffer = await fs.readFile(source_image_path);
        const base64Image = imageBuffer.toString("base64");
        const ext = path.extname(source_image_path).toLowerCase();
        const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

        const response = await ai.models.generateContent({
          model: "gemini-3-pro-image-preview",
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: base64Image } },
                {
                  text: "Remove the background from this image completely. Make the background fully transparent. Keep only the main subject with clean edges. Output as PNG with alpha transparency.",
                },
              ],
            },
          ],
          config: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            const buffer = Buffer.from(part.inlineData.data!, "base64");
            await fs.writeFile(outputPath, buffer);
            return {
              content: [
                { type: "text", text: `✅ Background removed (via Gemini):\n  → ${outputPath}` },
              ],
            };
          }
        }

        return {
          content: [{ type: "text", text: "Gemini didn't return an image. Try 'threshold' method instead." }],
        };
      } else {
        // Simple threshold-based background removal using sharp
        const image = sharp(source_image_path);
        const metadata = await image.metadata();

        // Convert to raw RGBA, trim edges based on dominant corner color
        const { data, info } = await image
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        // Sample corner pixels to determine background color
        const getPixel = (x: number, y: number) => {
          const idx = (y * info.width + x) * 4;
          return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
        };

        const corners = [
          getPixel(0, 0),
          getPixel(info.width - 1, 0),
          getPixel(0, info.height - 1),
          getPixel(info.width - 1, info.height - 1),
        ];

        // Average corner color as background reference
        const bgColor = {
          r: Math.round(corners.reduce((s, c) => s + c.r, 0) / 4),
          g: Math.round(corners.reduce((s, c) => s + c.g, 0) / 4),
          b: Math.round(corners.reduce((s, c) => s + c.b, 0) / 4),
        };

        const threshold = 40; // Color distance threshold
        const newData = Buffer.from(data);

        for (let i = 0; i < newData.length; i += 4) {
          const dr = newData[i] - bgColor.r;
          const dg = newData[i + 1] - bgColor.g;
          const db = newData[i + 2] - bgColor.b;
          const distance = Math.sqrt(dr * dr + dg * dg + db * db);

          if (distance < threshold) {
            newData[i + 3] = 0; // Set alpha to 0 (transparent)
          }
        }

        await sharp(newData, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .png()
          .toFile(outputPath);

        return {
          content: [
            {
              type: "text",
              text: `✅ Background removed (threshold method, bg color ~rgb(${bgColor.r},${bgColor.g},${bgColor.b})):\n  → ${outputPath}\n\n💡 For better results, try method='gemini'.`,
            },
          ],
        };
      }
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `❌ Background removal failed: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gemini Image MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
