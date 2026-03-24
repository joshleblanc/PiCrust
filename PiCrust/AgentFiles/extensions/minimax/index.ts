/**
 * MiniMax AI Extension for pi
 *
 * Provides AI-powered tools:
 * - web_search: Search the web and get structured results
 * - understand_image: Analyze images using AI
 * - generate_image: Generate images from text prompts using AI
 * - transform_image: Transform existing images using AI (image-to-image)
 * - generate_music: Generate music using AI
 * - generate_lyrics: Generate song lyrics using AI
 * - generate_video: Generate videos from text prompts using AI
 * - generate_video_from_image: Generate videos from images using AI
 * - generate_video_with_frames: Generate videos from first/last frame images
 * - generate_video_with_subject: Generate videos with subject reference
 * - query_video: Query video generation status
 * - download_video: Get video download URL
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

// Configuration - get API key from environment variable
const getConfig = () => ({
  apiKey: process.env.MINIMAX_API_KEY,
  apiHost: process.env.MINIMAX_API_HOST || "https://api.minimax.io",
});

// Validate config and throw helpful error if missing
function validateConfig() {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error("MINIMAX_API_KEY environment variable is not set");
  }
  if (!config.apiHost) {
    throw new Error("MINIMAX_API_HOST environment variable is not set");
  }
  return config;
}

// Response types matching MiniMax MCP server format
interface WebSearchResponse {
  organic: Array<{
    title: string;
    link: string;
    snippet: string;
    date?: string;
  }>;
  related_searches: Array<{
    query: string;
  }>;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface VLMResponse {
  content: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface ImageGenerationResponse {
  id: string;
  data: {
    image_urls?: string[];
    image_base64?: string[];
  };
  metadata: {
    success_count: number;
    failed_count: number;
  };
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface MusicGenerationResponse {
  data: {
    status: number;
    audio?: string;
  };
  base_resp: {
    status_code: number;
    status_msg: string;
  };
  extra_info?: {
    duration?: number;
    sample_rate?: number;
    bitrate?: number;
    size?: number;
  };
}

interface LyricsGenerationResponse {
  song_title?: string;
  style_tags?: string;
  lyrics?: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface VideoGenerationResponse {
  task_id?: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface VideoQueryResponse {
  task_id?: string;
  status?: "Preparing" | "Queueing" | "Processing" | "Success" | "Fail";
  file_id?: string;
  video_width?: number;
  video_height?: number;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface VideoDownloadResponse {
  file?: {
    file_id?: number;
    bytes?: number;
    created_at?: number;
    filename?: string;
    purpose?: string;
    download_url?: string;
  };
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

// Helper to normalize URLs - replace http:// with https://
function normalizeUrl(url: string): string {
  if (url.startsWith("http://")) {
    return url.replace("http://", "https://");
  }
  return url;
}

/**
 * Process image URL and convert to base64 data URL format.
 * 1. HTTP/HTTPS URLs: Downloads the image and converts to base64
 * 2. Base64 data URLs: Passes through as-is
 * 3. Local file paths: Reads the file and converts to base64
 */
async function processImageUrl(imageUrl: string): Promise<string> {
  // Remove @ prefix if present
  if (imageUrl.startsWith("@")) {
    imageUrl = imageUrl.substring(1);
  }

  // If already in base64 data URL format, pass through
  if (imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  // Handle HTTP/HTTPS URLs
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    try {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`);
      }
      const imageData = await imageResponse.arrayBuffer();

      // Detect image format from content-type header
      const contentType = imageResponse.headers.get('content-type')?.toLowerCase() || '';
      let imageFormat = 'jpeg'; // Default
      if (contentType.includes('png')) {
        imageFormat = 'png';
      } else if (contentType.includes('webp')) {
        imageFormat = 'webp';
      } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        imageFormat = 'jpeg';
      }

      // Convert to base64 data URL
      const base64Data = Buffer.from(imageData).toString('base64');
      return `data:image/${imageFormat};base64,${base64Data}`;

    } catch (error) {
      throw new Error(`Failed to download image from URL: ${error}`);
    }
  }

  // Handle local file paths (including Windows paths)
  else {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Resolve the file path
      const resolvedPath = path.resolve(imageUrl);
      const fileHandle = await fs.open(resolvedPath, 'r');
      const fileBuffer = await fileHandle.readFile();
      await fileHandle.close();

      // Detect image format from file extension
      let imageFormat = 'jpeg'; // Default
      const lowerPath = resolvedPath.toLowerCase();
      if (lowerPath.endsWith('.png')) {
        imageFormat = 'png';
      } else if (lowerPath.endsWith('.webp')) {
        imageFormat = 'webp';
      } else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
        imageFormat = 'jpeg';
      }

      const base64Data = fileBuffer.toString('base64');
      return `data:image/${imageFormat};base64,${base64Data}`;

    } catch (error) {
      throw new Error(`Failed to read local image file: ${error}`);
    }
  }
}

export default function (pi: ExtensionAPI) {
  // Notify on load
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("MiniMax extension loaded", "info");
  });

  // Register web_search tool
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: `Search the web using MiniMax AI and get structured search results.

    Returns organic search results with titles, URLs, snippets, and related searches.
    Use this to find up-to-date information on any topic.`,
    parameters: Type.Object({
      query: Type.String({
        description: "The search query",
        examples: ["latest AI news", "TypeScript best practices 2024"],
      }),
      num_results: Type.Optional(Type.Number({
        description: "Number of results to return (default: 5)",
        minimum: 1,
        maximum: 20,
      })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/coding_plan/search`;

      onUpdate?.({
        content: [{ type: "text", text: `Searching: "${params.query}"...` }],
        details: { status: "searching", query: params.query },
      });

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify({
            q: params.query,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: WebSearchResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format results for the LLM
        let output = `## Web Search Results: "${params.query}"\n\n`;

        if (result.organic && result.organic.length > 0) {
          for (const r of result.organic) {
            output += `### ${r.title}\n`;
            output += `- **URL:** ${r.link}\n`;
            output += `- **Snippet:** ${r.snippet}\n\n`;
          }
        }

        if (result.related_searches && result.related_searches.length > 0) {
          output += `## Related Searches\n\n`;
          for (const rs of result.related_searches) {
            output += `- ${rs.query}\n`;
          }
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            query: params.query,
            resultCount: result.organic?.length || 0,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Search Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, query: params.query },
          isError: true,
        };
      }
    },
  });

  // Register understand_image tool
  pi.registerTool({
    name: "understand_image",
    label: "Understand Image",
    description: `Analyze images using MiniMax AI and get detailed understanding.

    Supports:
    - Local file paths
    - Image URLs (JPEG, PNG, WebP formats)

    Returns AI-generated description and answers about the image.`,
    parameters: Type.Object({
      image: Type.String({
        description: "URL or local path to the image",
        examples: [
          "https://example.com/image.png",
          "./screenshot.png",
          "/home/user/photo.jpg",
        ],
      }),
      prompt: Type.Optional(
        Type.String({
          description: "Question or prompt about the image (default: describe the image)",
          examples: [
            "What does this diagram show?",
            "List all the objects in this image",
            "Extract any text visible in this image",
          ],
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/coding_plan/vlm`;

      onUpdate?.({
        content: [{ type: "text", text: `Analyzing image...` }],
        details: { status: "analyzing", image: params.image },
      });

      try {
        // Process image URL (convert to base64 data URL)
        const processedImageUrl = await processImageUrl(params.image);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify({
            image_url: processedImageUrl,
            prompt: params.prompt || "Describe this image in detail",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: VLMResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        return {
          content: [{ type: "text", text: `## Image Analysis\n\n${result.content || ""}` }],
          details: {
            image: params.image,
            prompt: params.prompt || "Describe this image in detail",
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Image Analysis Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, image: params.image },
          isError: true,
        };
      }
    },
  });

  // Register generate_image tool
  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description: `Generate images from text prompts using MiniMax AI.

    Creates high-quality images based on text descriptions. Supports various aspect ratios
    and can generate multiple images at once.

    Note: Generated image URLs expire after 24 hours.`,
    parameters: Type.Object({
      prompt: Type.String({
        description: "Text description of the image to generate (max 1500 characters)",
        examples: [
          "A serene beach at sunset with palm trees",
          "A futuristic cityscape with flying cars",
          "A man in a white t-shirt, full-body, standing front view, outdoors",
        ],
      }),
      model: Type.Optional(
        Type.String({
          description: "Model to use for image generation",
          default: "image-01",
        })
      ),
      aspect_ratio: Type.Optional(
        Type.String({
          description: "Image aspect ratio",
          enum: ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"],
          default: "1:1",
        })
      ),
      width: Type.Optional(
        Type.Number({
          description: "Image width in pixels (512-2048, divisible by 8). If provided alongside aspect_ratio, aspect_ratio takes priority.",
          minimum: 512,
          maximum: 2048,
        })
      ),
      height: Type.Optional(
        Type.Number({
          description: "Image height in pixels (512-2048, divisible by 8). If provided alongside aspect_ratio, aspect_ratio takes priority.",
          minimum: 512,
          maximum: 2048,
        })
      ),
      response_format: Type.Optional(
        Type.String({
          description: "Format for the generated image",
          enum: ["url", "base64"],
          default: "url",
        })
      ),
      seed: Type.Optional(
        Type.Number({
          description: "Random seed for reproducible generation. Same seed with same prompt produces similar images.",
        })
      ),
      n: Type.Optional(
        Type.Number({
          description: "Number of images to generate (1-9)",
          minimum: 1,
          maximum: 9,
          default: 1,
        })
      ),
      prompt_optimizer: Type.Optional(
        Type.Boolean({
          description: "Whether to automatically optimize the prompt for better results",
          default: true,
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/image_generation`;

      onUpdate?.({
        content: [{ type: "text", text: `Generating image(s)...` }],
        details: { status: "generating", prompt: params.prompt },
      });

      try {
        const requestBody: Record<string, unknown> = {
          prompt: params.prompt,
          model: params.model || "image-01",
          response_format: params.response_format || "url",
          n: params.n || 1,
          prompt_optimizer: params.prompt_optimizer || false,
        };

        // Add aspect_ratio or width/height
        if (params.aspect_ratio) {
          requestBody.aspect_ratio = params.aspect_ratio;
        } else if (params.width && params.height) {
          requestBody.width = params.width;
          requestBody.height = params.height;
        }

        // Add seed if provided
        if (params.seed !== undefined) {
          requestBody.seed = params.seed;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: ImageGenerationResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format output based on response format
        let output = `## Generated Image${(result.metadata.success_count || 1) > 1 ? "s" : ""}\n\n`;
        output += `**Prompt:** ${params.prompt}\n\n`;

        // Normalize URLs to use https
        const normalizedUrls = (result.data.image_urls || []).map(normalizeUrl);

        if (params.response_format === "base64" && result.data.image_base64) {
          output += `**Format:** Base64\n\n`;
          for (let i = 0; i < result.data.image_base64.length; i++) {
            output += `### Image ${i + 1}\n`;
            output += `Base64 data (truncated): ${result.data.image_base64[i].substring(0, 50)}...\n\n`;
          }
        } else if (normalizedUrls.length > 0) {
          output += `**Format:** URL (expires in 24 hours)\n\n`;
          for (let i = 0; i < normalizedUrls.length; i++) {
            output += `### Image ${i + 1}\n`;
            output += `**Image URL:** ${normalizedUrls[i]}\n\n`;
            output += `**View:** ${normalizedUrls[i]}\n\n`;
          }
        }

        output += `**Success:** ${result.metadata.success_count} | **Failed:** ${result.metadata.failed_count}`;

        // Send custom message for Discord to handle as file attachment
        if (normalizedUrls.length > 0 || (result.data.image_base64 && result.data.image_base64.length > 0)) {
          const mediaMessage = JSON.stringify({
            imageUrls: normalizedUrls,
            imageBase64: result.data.image_base64,
            prompt: params.prompt,
            model: params.model || "image-01",
          });
          _ctx.sendMessage?.({
            customType: "minimax_image",
            content: mediaMessage,
            display: false, // Don't show in pi UI, only in Discord
          });
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            prompt: params.prompt,
            model: params.model || "image-01",
            successCount: result.metadata.success_count,
            failedCount: result.metadata.failed_count,
            imageUrls: normalizedUrls,
            imageBase64: result.data.image_base64 ? result.data.image_base64.map((_, i) => `Image ${i + 1} base64 data`) : [],
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Image Generation Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, prompt: params.prompt },
          isError: true,
        };
      }
    },
  });

  // Register transform_image tool (image-to-image generation)
  pi.registerTool({
    name: "transform_image",
    label: "Transform Image",
    description: `Transform an existing image using AI (image-to-image generation).

    Takes a source image and generates a new image based on the text prompt.
    Supports local file paths (will be encoded to base64), public URLs, and data URLs.

    Note: Generated image URLs expire after 24 hours.`,
    parameters: Type.Object({
      prompt: Type.String({
        description: "Text description of the desired transformation (max 1500 characters)",
        examples: [
          "A girl looking into the distance from a library window",
          "Transform this into a cyberpunk style portrait",
          "Put this character in a medieval fantasy setting",
        ],
      }),
      image: Type.String({
        description: "Source image: URL, local path, or base64 data URL",
        examples: [
          "https://example.com/photo.jpg",
          "./portrait.png",
          "/home/user/image.png",
        ],
      }),
      model: Type.Optional(
        Type.String({
          description: "Model to use for image transformation",
          default: "image-01",
        })
      ),
      subject_type: Type.Optional(
        Type.String({
          description: "Type of subject reference",
          enum: ["character"],
          default: "character",
        })
      ),
      aspect_ratio: Type.Optional(
        Type.String({
          description: "Image aspect ratio",
          enum: ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"],
          default: "1:1",
        })
      ),
      width: Type.Optional(
        Type.Number({
          description: "Image width in pixels (512-2048, divisible by 8). If provided alongside aspect_ratio, aspect_ratio takes priority.",
          minimum: 512,
          maximum: 2048,
        })
      ),
      height: Type.Optional(
        Type.Number({
          description: "Image height in pixels (512-2048, divisible by 8). If provided alongside aspect_ratio, aspect_ratio takes priority.",
          minimum: 512,
          maximum: 2048,
        })
      ),
      response_format: Type.Optional(
        Type.String({
          description: "Format for the generated image",
          enum: ["url", "base64"],
          default: "url",
        })
      ),
      seed: Type.Optional(
        Type.Number({
          description: "Random seed for reproducible generation",
        })
      ),
      n: Type.Optional(
        Type.Number({
          description: "Number of images to generate (1-9)",
          minimum: 1,
          maximum: 9,
          default: 1,
        })
      ),
      prompt_optimizer: Type.Optional(
        Type.Boolean({
          description: "Whether to automatically optimize the prompt for better results",
          default: false,
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/image_generation`;

      onUpdate?.({
        content: [{ type: "text", text: `Transforming image...` }],
        details: { status: "transforming", prompt: params.prompt },
      });

      try {
        // Process image: convert local paths to base64, pass through URLs and data URLs
        const processedImage = await processImageUrl(params.image);

        const requestBody: Record<string, unknown> = {
          prompt: params.prompt,
          model: params.model || "image-01",
          response_format: params.response_format || "url",
          n: params.n || 1,
          prompt_optimizer: params.prompt_optimizer || false,
          subject_reference: [
            {
              type: params.subject_type || "character",
              image_file: processedImage,
            },
          ],
        };

        // Add aspect_ratio or width/height
        if (params.aspect_ratio) {
          requestBody.aspect_ratio = params.aspect_ratio;
        } else if (params.width && params.height) {
          requestBody.width = params.width;
          requestBody.height = params.height;
        }

        // Add seed if provided
        if (params.seed !== undefined) {
          requestBody.seed = params.seed;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: ImageGenerationResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Normalize URLs to use https
        const normalizedUrls = (result.data.image_urls || []).map(normalizeUrl);

        // Format output based on response format
        let output = `## Transformed Image${(result.metadata.success_count || 1) > 1 ? "s" : ""}\n\n`;
        output += `**Prompt:** ${params.prompt}\n\n`;

        if (params.response_format === "base64" && result.data.image_base64) {
          output += `**Format:** Base64\n\n`;
          for (let i = 0; i < result.data.image_base64.length; i++) {
            output += `### Image ${i + 1}\n`;
            output += `Base64 data (truncated): ${result.data.image_base64[i].substring(0, 50)}...\n\n`;
          }
        } else if (normalizedUrls.length > 0) {
          output += `**Format:** URL (expires in 24 hours)\n\n`;
          for (let i = 0; i < normalizedUrls.length; i++) {
            output += `### Image ${i + 1}\n`;
            output += `**Image URL:** ${normalizedUrls[i]}\n\n`;
            output += `**View:** ${normalizedUrls[i]}\n\n`;
          }
        }

        output += `**Success:** ${result.metadata.success_count} | **Failed:** ${result.metadata.failed_count}`;

        // Send custom message for Discord to handle as file attachment
        if (normalizedUrls.length > 0 || (result.data.image_base64 && result.data.image_base64.length > 0)) {
          const mediaMessage = JSON.stringify({
            imageUrls: normalizedUrls,
            imageBase64: result.data.image_base64,
            prompt: params.prompt,
            model: params.model || "image-01",
            isVariation: true,
          });
          _ctx.sendMessage?.({
            customType: "minimax_image",
            content: mediaMessage,
            display: false, // Don't show in pi UI, only in Discord
          });
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            prompt: params.prompt,
            model: params.model || "image-01",
            successCount: result.metadata.success_count,
            failedCount: result.metadata.failed_count,
            imageUrls: normalizedUrls,
            imageBase64: result.data.image_base64 ? result.data.image_base64.map((_, i) => `Image ${i + 1} base64 data`) : [],
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Image Transformation Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, prompt: params.prompt },
          isError: true,
        };
      }
    },
  });

  // Register generate_music tool
  pi.registerTool({
    name: "generate_music",
    label: "Generate Music",
    description: `Generate music using MiniMax AI.

    Creates original music tracks based on text descriptions of style, mood, and scenario.
    Can optionally include lyrics with structure tags like [Verse], [Chorus], [Bridge].

    Note: Audio URLs expire after 24 hours - download promptly.`,
    parameters: Type.Object({
      prompt: Type.Optional(
        Type.String({
          description: "Music description including style, mood, and scenario (1-2000 characters). Required if no lyrics provided.",
          examples: [
            "Indie folk, melancholic, introspective",
            "Upbeat electronic dance music with driving beats",
            "Peaceful ambient piano with soft strings",
          ],
        })
      ),
      lyrics: Type.Optional(
        Type.String({
          description: "Song lyrics with structure tags like [Verse], [Chorus], [Bridge] (1-3500 characters). Required if no prompt provided.",
          examples: [
            "[Verse 1]\nStreetlights flicker in the rain\n[Verse 2]\nMemories fade like yesterday",
          ],
        })
      ),
      model: Type.Optional(
        Type.String({
          description: "Model to use for music generation",
          default: "music-2.5+",
        })
      ),
      is_instrumental: Type.Optional(
        Type.Boolean({
          description: "Generate instrumental only (without vocals). Only works with music-2.5+ model.",
          default: false,
        })
      ),
      output_format: Type.Optional(
        Type.String({
          description: "Output format for the generated audio",
          enum: ["url", "hex"],
          default: "url",
        })
      ),
      sample_rate: Type.Optional(
        Type.Number({
          description: "Audio sample rate in Hz",
          enum: [16000, 24000, 32000, 44100],
        })
      ),
      bitrate: Type.Optional(
        Type.Number({
          description: "Audio bitrate in bps",
          enum: [32000, 64000, 128000, 256000],
        })
      ),
      audio_format: Type.Optional(
        Type.String({
          description: "Audio format",
          enum: ["mp3", "wav", "pcm"],
          default: "mp3",
        })
      ),
      lyrics_optimizer: Type.Optional(
        Type.Boolean({
          description: "Automatically generate lyrics from the prompt",
          default: true,
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/music_generation`;

      onUpdate?.({
        content: [{ type: "text", text: `Generating music...` }],
        details: { status: "generating", prompt: params.prompt },
      });

      try {
        const requestBody: Record<string, unknown> = {
          model: params.model || "music-2.5+",
          output_format: params.output_format || "url",
        };

        // Add prompt if provided
        if (params.prompt) {
          requestBody.prompt = params.prompt;
        }

        // Add lyrics if provided
        if (params.lyrics) {
          requestBody.lyrics = params.lyrics;
        }

        // Add instrumental flag if true (only for music-2.5+)
        if (params.is_instrumental === true) {
          requestBody.is_instrumental = true;
        }

        // Add lyrics optimizer if true
        if (params.lyrics_optimizer === true) {
          requestBody.lyrics_optimizer = true;
        }

        // Add audio settings if any are provided
        if (params.sample_rate || params.bitrate || params.audio_format) {
          requestBody.audio_setting = {};
          if (params.sample_rate) requestBody.audio_setting.sample_rate = params.sample_rate;
          if (params.bitrate) requestBody.audio_setting.bitrate = params.bitrate;
          if (params.audio_format) requestBody.audio_setting.format = params.audio_format;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: MusicGenerationResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Check if generation is still in progress (status 1 = in progress, 2 = completed)
        if (result.data.status === 1) {
          return {
            content: [{ type: "text", text: `⏳ **Music Generation In Progress**

Your music is being generated. Please try again in a moment to retrieve the completed track.

**Prompt:** ${params.prompt || "N/A"}
**Status:** Processing...` }],
            details: {
              status: "in_progress",
              prompt: params.prompt,
              model: params.model || "music-2.5+",
            },
          };
        }

        // Format output
        let output = `## Generated Music\n\n`;

        if (params.prompt) {
          output += `**Prompt:** ${params.prompt}\n\n`;
        }

        if (params.lyrics) {
          output += `**Lyrics:**\n${params.lyrics}\n\n`;
        }

        output += `**Model:** ${params.model || "music-2.5+"}\n\n`;

        if (result.extra_info) {
          const duration = result.extra_info.duration
            ? `${(result.extra_info.duration / 1000).toFixed(1)}s`
            : "N/A";
          const bitrate = result.extra_info.bitrate
            ? `${(result.extra_info.bitrate / 1000)}kbps`
            : "N/A";
          const sampleRate = result.extra_info.sample_rate
            ? `${result.extra_info.sample_rate}Hz`
            : "N/A";
          const size = result.extra_info.size
            ? `${(result.extra_info.size / 1024).toFixed(1)}KB`
            : "N/A";

          output += `**Duration:** ${duration} | **Bitrate:** ${bitrate} | **Sample Rate:** ${sampleRate} | **Size:** ${size}\n\n`;
        }

        if (params.output_format === "hex" && result.data.audio) {
          output += `**Format:** Hex-encoded audio\n\n`;
          output += `Audio data (truncated): ${result.data.audio.substring(0, 50)}...\n`;
        } else if (result.data.audio) {
          // URL format - normalize and display the audio URL
          const audioUrl = normalizeUrl(result.data.audio);
          output += `**Audio URL:** ${audioUrl}\n\n`;
          output += `**Download:** ${audioUrl}\n`;
        }

        output += `\n**Note:** Audio URLs expire after 24 hours - download promptly if needed.`;

        // Send custom message for Discord to handle as file attachment
        if (result.data.audio) {
          const mediaMessage = JSON.stringify({
            audioUrl: params.output_format !== "hex" ? normalizeUrl(result.data.audio) : undefined,
            audioHex: params.output_format === "hex" ? result.data.audio : undefined,
            prompt: params.prompt,
            lyrics: params.lyrics,
            model: params.model || "music-2.5+",
            duration: result.extra_info?.duration,
            bitrate: result.extra_info?.bitrate,
          });
          _ctx.sendMessage?.({
            customType: "minimax_audio",
            content: mediaMessage,
            display: false, // Don't show in pi UI, only in Discord
          });
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            prompt: params.prompt,
            lyrics: params.lyrics,
            model: params.model || "music-2.5+",
            isInstrumental: params.is_instrumental || false,
            audioUrl: params.output_format !== "hex" ? normalizeUrl(result.data.audio) : undefined,
            duration: result.extra_info?.duration,
            sampleRate: result.extra_info?.sample_rate,
            bitrate: result.extra_info?.bitrate,
            size: result.extra_info?.size,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Music Generation Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, prompt: params.prompt },
          isError: true,
        };
      }
    },
  });

  // Register generate_lyrics tool
  pi.registerTool({
    name: "generate_lyrics",
    label: "Generate Lyrics",
    description: `Generate song lyrics using MiniMax AI.

    Creates original lyrics with structural tags like [Verse], [Chorus], [Bridge].
    The generated lyrics can be used directly with the generate_music tool.

    Supports two modes:
    - write_full_song: Generate a complete new song
    - edit: Edit or continue existing lyrics`,
    parameters: Type.Object({
      mode: Type.String({
        description: "Generation mode",
        enum: ["write_full_song", "edit"],
        default: "write_full_song",
      }),
      prompt: Type.Optional(
        Type.String({
          description: "Theme, style, or instructions for generation (max 2000 characters)",
          examples: [
            "A cheerful love song about a summer day at the beach",
            "Melancholic indie folk about long-distance relationships",
            "Uplifting pop anthem about overcoming challenges",
          ],
        })
      ),
      lyrics: Type.Optional(
        Type.String({
          description: "Existing lyrics to edit or continue (only for edit mode, max 3500 characters)",
        })
      ),
      title: Type.Optional(
        Type.String({
          description: "Desired song title (will be preserved in output)",
          examples: [
            "Summer Breeze Promise",
            "Midnight Dreams",
            "Walking on Sunshine",
          ],
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/lyrics_generation`;

      onUpdate?.({
        content: [{ type: "text", text: `Generating lyrics...` }],
        details: { status: "generating", mode: params.mode },
      });

      try {
        const requestBody: Record<string, unknown> = {
          mode: params.mode,
        };

        // Add prompt if provided
        if (params.prompt) {
          requestBody.prompt = params.prompt;
        }

        // Add lyrics if provided (for edit mode)
        if (params.lyrics) {
          requestBody.lyrics = params.lyrics;
        }

        // Add title if provided
        if (params.title) {
          requestBody.title = params.title;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: LyricsGenerationResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format output
        let output = `## Generated Lyrics\n\n`;

        if (result.song_title) {
          output += `**Title:** ${result.song_title}\n\n`;
        }

        if (result.style_tags) {
          output += `**Style:** ${result.style_tags}\n\n`;
        }

        if (result.lyrics) {
          output += `### Lyrics\n\n${result.lyrics}\n`;
        }

        output += `\n---\n**Mode:** ${params.mode}`;
        if (params.prompt) {
          output += ` | **Prompt:** ${params.prompt}`;
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            songTitle: result.song_title,
            styleTags: result.style_tags,
            lyrics: result.lyrics,
            mode: params.mode,
            prompt: params.prompt,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Lyrics Generation Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, mode: params.mode },
          isError: true,
        };
      }
    },
  });

  // Register generate_video tool
  pi.registerTool({
    name: "generate_video",
    label: "Generate Video",
    description: `Generate videos from text prompts using MiniMax AI.

    Creates videos based on text descriptions with support for camera commands using [command] syntax.
    Video generation is asynchronous - a task_id is returned for tracking.

    Supported camera commands: [Pedestal up], [Pedestal down], [Static shot], [Pan left], [Pan right], [Tilt up], [Tilt down], [Dolly], [Tracking], and more.`,
    parameters: Type.Object({
      prompt: Type.String({
        description: "Text description of the video to generate (max 2000 characters). Supports camera commands like [Pedestal up], [Static shot]",
        examples: [
          "A man picks up a book [Pedestal up], then reads [Static shot].",
          "Ocean waves crashing on a beach at sunset [Pan left]",
          "A cat playing with a ball of yarn in a living room [Tracking]",
        ],
      }),
      model: Type.Optional(
        Type.String({
          description: "Model to use for video generation",
          default: "MiniMax-Hailuo-2.3",
        })
      ),
      prompt_optimizer: Type.Optional(
        Type.Boolean({
          description: "Automatically optimize the prompt for better results",
          default: true,
        })
      ),
      fast_pretreatment: Type.Optional(
        Type.Boolean({
          description: "Reduces optimization time for specific models",
          default: false,
        })
      ),
      duration: Type.Optional(
        Type.Number({
          description: "Video duration in seconds",
          default: 6,
        })
      ),
      resolution: Type.Optional(
        Type.String({
          description: "Video resolution",
          enum: ["720P", "768P", "1080P"],
        })
      ),
      callback_url: Type.Optional(
        Type.String({
          description: "Webhook URL for async status updates when video is ready",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/video_generation`;

      onUpdate?.({
        content: [{ type: "text", text: `Generating video...` }],
        details: { status: "generating", prompt: params.prompt },
      });

      try {
        const requestBody: Record<string, unknown> = {
          model: params.model || "MiniMax-Hailuo-2.3",
          prompt: params.prompt,
          prompt_optimizer: params.prompt_optimizer !== false,
        };

        // Add optional parameters
        if (params.fast_pretreatment) {
          requestBody.fast_pretreatment = true;
        }

        if (params.duration) {
          requestBody.duration = params.duration;
        }

        if (params.resolution) {
          requestBody.resolution = params.resolution;
        }

        if (params.callback_url) {
          requestBody.callback_url = params.callback_url;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: VideoGenerationResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format output
        let output = `## Generated Video\n\n`;
        output += `**Prompt:** ${params.prompt}\n\n`;
        output += `**Model:** ${params.model || "MiniMax-Hailuo-2.3"}\n\n`;

        if (params.duration) {
          output += `**Duration:** ${params.duration}s\n`;
        }

        if (params.resolution) {
          output += `**Resolution:** ${params.resolution}\n`;
        }

        output += `\n**Task ID:** ${result.task_id}\n\n`;
        output += `Video generation is in progress. Use the task_id to check status or wait for callback if callback_url was provided.`;

        return {
          content: [{ type: "text", text: output }],
          details: {
            prompt: params.prompt,
            model: params.model || "MiniMax-Hailuo-2.3",
            taskId: result.task_id,
            duration: params.duration,
            resolution: params.resolution,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Video Generation Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, prompt: params.prompt },
          isError: true,
        };
      }
    },
  });

  // Register generate_video_from_image tool (image-to-video)
  pi.registerTool({
    name: "generate_video_from_image",
    label: "Generate Video from Image",
    description: `Generate a video from an image using MiniMax AI (image-to-video).

    Takes a source image and generates a video based on the text prompt and camera commands.
    Supports local file paths (will be encoded to base64), public URLs, and data URLs.

    Video generation is asynchronous - a task_id is returned for tracking.

    Supported camera commands: [Pan left], [Pan right], [Zoom in], [Zoom out], [Tilt up], [Tilt down], [Pedestal up], [Pedestal down], [Static shot], and more.`,
    parameters: Type.Object({
      image: Type.String({
        description: "Source image: URL, local path, or base64 data URL (JPG, PNG, WebP; short edge >300px)",
        examples: [
          "https://example.com/photo.jpg",
          "./portrait.png",
          "/home/user/image.png",
        ],
      }),
      prompt: Type.Optional(
        Type.String({
          description: "Video description (max 2000 characters). Supports camera commands like [Pan left], [Zoom in]",
          examples: [
            "A mouse runs toward the camera, smiling and blinking [Pan left]",
            "The flower slowly opens up [Zoom in]",
            "Clouds drifting across the sky [Pan right]",
          ],
        })
      ),
      model: Type.Optional(
        Type.String({
          description: "Model to use for video generation",
          default: "MiniMax-Hailuo-2.3",
        })
      ),
      prompt_optimizer: Type.Optional(
        Type.Boolean({
          description: "Automatically optimize the prompt for better results",
          default: true,
        })
      ),
      fast_pretreatment: Type.Optional(
        Type.Boolean({
          description: "Reduces optimization time (2.3/2.3-Fast/02 models only)",
          default: false,
        })
      ),
      duration: Type.Optional(
        Type.Number({
          description: "Video duration in seconds (6 or 10 depending on model/resolution)",
          default: 6,
        })
      ),
      resolution: Type.Optional(
        Type.String({
          description: "Video resolution",
          enum: ["512P", "720P", "768P", "1080P"],
        })
      ),
      callback_url: Type.Optional(
        Type.String({
          description: "Webhook URL for async status updates when video is ready",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/video_generation`;

      onUpdate?.({
        content: [{ type: "text", text: `Generating video from image...` }],
        details: { status: "generating", image: params.image },
      });

      try {
        // Process image: convert local paths to base64, pass through URLs and data URLs
        const processedImage = await processImageUrl(params.image);

        const requestBody: Record<string, unknown> = {
          model: params.model || "MiniMax-Hailuo-2.3",
          first_frame_image: processedImage,
          prompt_optimizer: params.prompt_optimizer !== false,
        };

        // Add prompt if provided
        if (params.prompt) {
          requestBody.prompt = params.prompt;
        }

        // Add optional parameters
        if (params.fast_pretreatment) {
          requestBody.fast_pretreatment = true;
        }

        if (params.duration) {
          requestBody.duration = params.duration;
        }

        if (params.resolution) {
          requestBody.resolution = params.resolution;
        }

        if (params.callback_url) {
          requestBody.callback_url = params.callback_url;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: VideoGenerationResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format output
        let output = `## Generated Video from Image\n\n`;
        output += `**Model:** ${params.model || "MiniMax-Hailuo-2.3"}\n\n`;

        if (params.prompt) {
          output += `**Prompt:** ${params.prompt}\n`;
        }

        if (params.duration) {
          output += `**Duration:** ${params.duration}s\n`;
        }

        if (params.resolution) {
          output += `**Resolution:** ${params.resolution}\n`;
        }

        output += `\n**Task ID:** ${result.task_id}\n\n`;
        output += `Video generation is in progress. Use the task_id to check status or wait for callback if callback_url was provided.`;

        return {
          content: [{ type: "text", text: output }],
          details: {
            prompt: params.prompt,
            model: params.model || "MiniMax-Hailuo-2.3",
            taskId: result.task_id,
            duration: params.duration,
            resolution: params.resolution,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Video Generation Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, image: params.image },
          isError: true,
        };
      }
    },
  });

  // Register generate_video_with_frames tool (first/last frame video)
  pi.registerTool({
    name: "generate_video_with_frames",
    label: "Generate Video with Frames",
    description: `Generate a video from first and last frame images using MiniMax AI (first-last frame video).

    Creates a video transition from a starting frame to an ending frame with optional text prompt.
    Supports local file paths (will be encoded to base64), public URLs, and data URLs.

    Video generation is asynchronous - a task_id is returned for tracking.

    Supported camera commands: [Pan left], [Pan right], [Push in], [Pull out], [Pedestal up], [Pedestal down], [Tilt up], [Tilt down], [Zoom in], [Zoom out], [Shake], [Tracking shot], [Static shot].`,
    parameters: Type.Object({
      last_frame_image: Type.String({
        description: "Ending frame image: URL, local path, or base64 data URL (JPG, PNG, WebP; short edge >300px)",
        examples: [
          "https://example.com/end_frame.jpg",
          "./end_portrait.png",
          "/home/user/end_image.png",
        ],
      }),
      first_frame_image: Type.Optional(
        Type.String({
          description: "Starting frame image: URL, local path, or base64 data URL (JPG, PNG, WebP; short edge >300px). If not provided, video starts from last frame.",
          examples: [
            "https://example.com/start_frame.jpg",
            "./start_portrait.png",
            "/home/user/start_image.png",
          ],
        })
      ),
      prompt: Type.Optional(
        Type.String({
          description: "Video description (max 2000 characters). Supports camera commands like [Pan left], [Zoom in]",
          examples: [
            "A little girl grow up [Pan right]",
            "The flower slowly opens up [Zoom in]",
            "Transformation from caterpillar to butterfly [Push in]",
          ],
        })
      ),
      model: Type.Optional(
        Type.String({
          description: "Model to use for video generation",
          default: "MiniMax-Hailuo-02",
        })
      ),
      prompt_optimizer: Type.Optional(
        Type.Boolean({
          description: "Automatically optimize the prompt for better results",
          default: true,
        })
      ),
      duration: Type.Optional(
        Type.Number({
          description: "Video duration in seconds (6 or 10)",
          default: 6,
        })
      ),
      resolution: Type.Optional(
        Type.String({
          description: "Video resolution (768P or 1080P; 10s only supports 768P)",
          enum: ["768P", "1080P"],
        })
      ),
      callback_url: Type.Optional(
        Type.String({
          description: "Webhook URL for async status updates when video is ready",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/video_generation`;

      onUpdate?.({
        content: [{ type: "text", text: `Generating video from frames...` }],
        details: { status: "generating" },
      });

      try {
        // Process last frame image
        const processedLastFrame = await processImageUrl(params.last_frame_image);

        const requestBody: Record<string, unknown> = {
          model: params.model || "MiniMax-Hailuo-02",
          last_frame_image: processedLastFrame,
          prompt_optimizer: params.prompt_optimizer !== false,
        };

        // Add first frame if provided
        if (params.first_frame_image) {
          const processedFirstFrame = await processImageUrl(params.first_frame_image);
          requestBody.first_frame_image = processedFirstFrame;
        }

        // Add prompt if provided
        if (params.prompt) {
          requestBody.prompt = params.prompt;
        }

        // Add optional parameters
        if (params.duration) {
          requestBody.duration = params.duration;
        }

        if (params.resolution) {
          requestBody.resolution = params.resolution;
        }

        if (params.callback_url) {
          requestBody.callback_url = params.callback_url;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: VideoGenerationResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format output
        let output = `## Generated Video from Frames\n\n`;
        output += `**Model:** ${params.model || "MiniMax-Hailuo-02"}\n\n`;

        if (params.prompt) {
          output += `**Prompt:** ${params.prompt}\n`;
        }

        if (params.duration) {
          output += `**Duration:** ${params.duration}s\n`;
        }

        if (params.resolution) {
          output += `**Resolution:** ${params.resolution}\n`;
        }

        output += `\n**Task ID:** ${result.task_id}\n\n`;
        output += `Video generation is in progress. Use the task_id to check status or wait for callback if callback_url was provided.`;

        return {
          content: [{ type: "text", text: output }],
          details: {
            prompt: params.prompt,
            model: params.model || "MiniMax-Hailuo-02",
            taskId: result.task_id,
            duration: params.duration,
            resolution: params.resolution,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Video Generation Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage },
          isError: true,
        };
      }
    },
  });

  // Register generate_video_with_subject tool (subject-reference video)
  pi.registerTool({
    name: "generate_video_with_subject",
    label: "Generate Video with Subject",
    description: `Generate a video with a subject reference using MiniMax AI (S2V).

    Uses a character image reference to generate videos featuring that subject.
    Supports local file paths (will be encoded to base64), public URLs, and data URLs.

    Video generation is asynchronous - a task_id is returned for tracking.`,
    parameters: Type.Object({
      subject_image: Type.String({
        description: "Subject reference image: URL, local path, or base64 data URL (JPG, PNG, WebP; short edge >300px)",
        examples: [
          "https://example.com/portrait.jpg",
          "./portrait.png",
          "/home/user/photo.png",
        ],
      }),
      prompt: Type.Optional(
        Type.String({
          description: "Video description (max 2000 characters)",
          examples: [
            "A girl runs toward the camera and winks with a smile",
            "The person dances happily in the rain",
            "Someone reading a book by the window",
          ],
        })
      ),
      prompt_optimizer: Type.Optional(
        Type.Boolean({
          description: "Automatically optimize the prompt for better results",
          default: true,
        })
      ),
      callback_url: Type.Optional(
        Type.String({
          description: "Webhook URL for async status updates when video is ready",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/video_generation`;

      onUpdate?.({
        content: [{ type: "text", text: `Generating video with subject reference...` }],
        details: { status: "generating", subjectImage: params.subject_image },
      });

      try {
        // Process subject image
        const processedImage = await processImageUrl(params.subject_image);

        const requestBody: Record<string, unknown> = {
          model: "S2V-01",
          subject_reference: [
            {
              type: "character",
              image: [processedImage],
            },
          ],
          prompt_optimizer: params.prompt_optimizer !== false,
        };

        // Add prompt if provided
        if (params.prompt) {
          requestBody.prompt = params.prompt;
        }

        // Add callback URL if provided
        if (params.callback_url) {
          requestBody.callback_url = params.callback_url;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: VideoGenerationResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format output
        let output = `## Generated Video with Subject\n\n`;
        output += `**Model:** S2V-01\n\n`;

        if (params.prompt) {
          output += `**Prompt:** ${params.prompt}\n`;
        }

        output += `\n**Task ID:** ${result.task_id}\n\n`;
        output += `Video generation is in progress. Use the task_id to check status or wait for callback if callback_url was provided.`;

        return {
          content: [{ type: "text", text: output }],
          details: {
            prompt: params.prompt,
            model: "S2V-01",
            taskId: result.task_id,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Video Generation Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, subjectImage: params.subject_image },
          isError: true,
        };
      }
    },
  });

  // Register query_video tool
  pi.registerTool({
    name: "query_video",
    label: "Query Video Status",
    description: `Query the status of a video generation task.

    Use the task_id returned from generate_video to check if the video is ready.
    Returns the video file_id and dimensions when successful.`,
    parameters: Type.Object({
      task_id: Type.String({
        description: "The task ID to query",
        examples: ["176843862716480", "123456789012345"],
      }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/query/video_generation?task_id=${encodeURIComponent(params.task_id)}`;

      onUpdate?.({
        content: [{ type: "text", text: `Querying video status...` }],
        details: { status: "querying", taskId: params.task_id },
      });

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: VideoQueryResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format output based on status
        let output = `## Video Generation Status\n\n`;
        output += `**Task ID:** ${result.task_id}\n`;
        output += `**Status:** ${result.status}\n\n`;

        if (result.status === "Success") {
          output += `### Video Ready\n\n`;
          output += `**File ID:** ${result.file_id}\n`;
          if (result.video_width && result.video_height) {
            output += `**Resolution:** ${result.video_width}x${result.video_height}\n`;
          }
          output += `\nYour video has been generated successfully. Use the file_id to access the video (note: file_id is not the direct URL).`;
        } else if (result.status === "Fail") {
          output += `Video generation failed. Please try again with a different prompt.`;
        } else {
          output += `Video is still ${result.status.toLowerCase()}. Please query again in a few moments.`;
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            taskId: result.task_id,
            status: result.status,
            fileId: result.file_id,
            videoWidth: result.video_width,
            videoHeight: result.video_height,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Video Query Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, taskId: params.task_id },
          isError: true,
        };
      }
    },
  });

  // Register download_video tool
  pi.registerTool({
    name: "download_video",
    label: "Download Video",
    description: `Get the download URL for a generated video.

    Use the file_id returned from query_video to get the download URL.
    Note: The download URL expires after 1 hour.`,
    parameters: Type.Object({
      file_id: Type.String({
        description: "The file ID returned from query_video",
        examples: ["176844028768320", "123456789012345"],
      }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const config = validateConfig();
      const url = `${config.apiHost}/v1/files/retrieve?file_id=${encodeURIComponent(params.file_id)}`;

      onUpdate?.({
        content: [{ type: "text", text: `Fetching video download URL...` }],
        details: { status: "downloading", fileId: params.file_id },
      });

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "MM-API-Source": "Minimax-MCP",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`MiniMax API error (${response.status}): ${errorText}`);
        }

        const result: VideoDownloadResponse = await response.json();

        // Check for API error
        if (result.base_resp.status_code !== 0) {
          throw new Error(`MiniMax API error (${result.base_resp.status_code}): ${result.base_resp.status_msg}`);
        }

        // Format output
        let output = `## Video Download\n\n`;

        if (result.file) {
          output += `**Filename:** ${result.file.filename || "video.mp4"}\n`;
          output += `**File ID:** ${result.file.file_id}\n`;

          if (result.file.bytes) {
            const sizeMB = (result.file.bytes / (1024 * 1024)).toFixed(2);
            output += `**Size:** ${sizeMB} MB\n`;
          }

          output += `\n`;

          if (result.file.download_url) {
            const downloadUrl = normalizeUrl(result.file.download_url);
            output += `### Download URL\n\n`;
            output += `**URL:** ${downloadUrl}\n\n`;
            output += `**Download:** ${downloadUrl}\n\n`;
            output += `⚠️ **Note:** This download URL expires in 1 hour. Download the video promptly.`;
          }
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            fileId: result.file?.file_id,
            filename: result.file?.filename,
            bytes: result.file?.bytes,
            downloadUrl: result.file?.download_url ? normalizeUrl(result.file.download_url) : undefined,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `❌ **Video Download Error:**\n\n${errorMessage}` }],
          details: { error: errorMessage, fileId: params.file_id },
          isError: true,
        };
      }
    },
  });
}
