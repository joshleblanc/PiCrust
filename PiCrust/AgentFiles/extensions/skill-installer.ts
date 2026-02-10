/**
 * Skill Installer Extension
 *
 * Lets the agent install skills from URLs at runtime.
 * A skill is a .md file (and any files it references) hosted at a URL.
 * Referenced files are auto-fetched from the same base URL.
 *
 * Tools:
 *   install_skill    — fetch a skill from a URL and save it to skills/
 *   uninstall_skill  — remove an installed skill
 *   list_skills      — list all installed skills
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "fs";
import * as path from "path";

export default function (pi: ExtensionAPI) {
  const skillsDir = path.resolve("skills");

  function ensureSkillsDir() {
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }
  }

  function getBaseUrl(url: string): string {
    const lastSlash = url.lastIndexOf("/");
    return lastSlash > url.indexOf("://") + 2 ? url.substring(0, lastSlash) : url;
  }

  function getSkillName(url: string): string {
    const filename = url.split("/").pop() || "skill";
    return filename.replace(/\.\w+$/, "");
  }

  /** Find files referenced in markdown content (relative links and backtick mentions). */
  function findReferencedFiles(content: string): string[] {
    const refs = new Set<string>();
    let match;

    // Markdown links: [text](file.ext) — skip absolute URLs, anchors, mailto
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = linkRegex.exec(content)) !== null) {
      const href = match[2];
      if (!href.startsWith("http") && !href.startsWith("#") && !href.startsWith("mailto:")) {
        refs.add(href);
      }
    }

    // Backtick references: `filename.ext` — only if it looks like a plain filename
    const backtickRegex = /`([^`\s]+\.\w{1,10})`/g;
    while ((match = backtickRegex.exec(content)) !== null) {
      const ref = match[1];
      if (/^[\w\-\/\.]+$/.test(ref) && !ref.startsWith(".") && !ref.includes("..")) {
        refs.add(ref);
      }
    }

    return Array.from(refs);
  }

  /** Guard against path traversal — resolved path must stay inside skillDir. */
  function isSafePath(skillDir: string, relativePath: string): boolean {
    const resolved = path.resolve(skillDir, relativePath);
    return resolved.startsWith(skillDir + path.sep) || resolved === skillDir;
  }

  async function fetchText(url: string): Promise<{ ok: boolean; text: string; status: number }> {
    try {
      const response = await fetch(url);
      const text = await response.text();
      return { ok: response.ok, text, status: response.status };
    } catch (err: any) {
      return { ok: false, text: err.message || "Fetch failed", status: 0 };
    }
  }

  // Tool: install_skill
  pi.registerTool({
    name: "install_skill",
    label: "Install Skill",
    description:
      "Install a skill from a URL. Fetches the skill file and any files it references from the same base URL. " +
      "Files are saved to skills/<name>/. Example: install_skill(url: 'https://example.com/cool-skill.md')",
    parameters: Type.Object({
      url: Type.String({
        description: "URL to the skill file (e.g. https://example.com/skills/my-skill.md)",
      }),
      name: Type.Optional(
        Type.String({
          description: "Override the skill name (defaults to the filename without extension)",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal) {
      const url = params.url?.trim();
      if (!url) {
        return {
          content: [{ type: "text", text: "Usage: install_skill(url: 'https://example.com/skill.md')" }],
          details: { success: false },
        };
      }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return {
          content: [{ type: "text", text: "URL must start with http:// or https://" }],
          details: { success: false },
        };
      }

      ensureSkillsDir();

      const skillName = (params.name?.trim() || getSkillName(url)).replace(/[^\w\-]/g, "-");
      const baseUrl = getBaseUrl(url);
      const skillDir = path.join(skillsDir, skillName);

      // Fetch main skill file
      const mainResult = await fetchText(url);
      if (!mainResult.ok) {
        return {
          content: [{ type: "text", text: `Failed to fetch ${url} (HTTP ${mainResult.status}): ${mainResult.text.slice(0, 200)}` }],
          details: { success: false },
        };
      }

      // Create skill directory
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      // Save main file
      const mainFilename = url.split("/").pop() || "skill.md";
      fs.writeFileSync(path.join(skillDir, mainFilename), mainResult.text, "utf-8");

      // Discover and fetch referenced files
      const refs = findReferencedFiles(mainResult.text);
      const fetched: string[] = [mainFilename];
      const failed: string[] = [];

      for (const ref of refs) {
        if (!isSafePath(skillDir, ref)) {
          failed.push(`${ref} (blocked: path traversal)`);
          continue;
        }

        const refUrl = `${baseUrl}/${ref}`;
        const refResult = await fetchText(refUrl);

        if (refResult.ok) {
          const destPath = path.join(skillDir, ref);
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          fs.writeFileSync(destPath, refResult.text, "utf-8");
          fetched.push(ref);
        } else {
          failed.push(`${ref} (HTTP ${refResult.status})`);
        }
      }

      let summary = `Installed skill "${skillName}" to skills/${skillName}/\n\nFiles fetched:\n${fetched.map(f => `  - ${f}`).join("\n")}`;
      if (failed.length > 0) {
        summary += `\n\nCould not fetch:\n${failed.map(f => `  - ${f}`).join("\n")}`;
      }

      return {
        content: [{ type: "text", text: summary }],
        details: { success: true, skillName, fetched, failed },
      };
    },
  });

  // Tool: uninstall_skill
  pi.registerTool({
    name: "uninstall_skill",
    label: "Uninstall Skill",
    description: "Remove an installed skill by name (the directory name under skills/)",
    parameters: Type.Object({
      name: Type.String({
        description: "Name of the skill to remove",
      }),
    }),
    async execute(_toolCallId, params, _signal) {
      const name = params.name?.trim();
      if (!name) {
        return {
          content: [{ type: "text", text: "Usage: uninstall_skill(name: 'skill-name')" }],
          details: { success: false },
        };
      }

      const skillDir = path.join(skillsDir, name);
      if (!fs.existsSync(skillDir)) {
        return {
          content: [{ type: "text", text: `Skill "${name}" not found in skills/` }],
          details: { success: false },
        };
      }

      fs.rmSync(skillDir, { recursive: true, force: true });

      return {
        content: [{ type: "text", text: `Removed skill "${name}"` }],
        details: { success: true, name },
      };
    },
  });

  // Tool: list_skills
  pi.registerTool({
    name: "list_skills",
    label: "List Skills",
    description: "List all installed skills and their files",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal) {
      ensureSkillsDir();

      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      const skills = entries
        .filter((e: any) => e.isDirectory())
        .map((e: any) => {
          const dir = path.join(skillsDir, e.name);
          const files = fs.readdirSync(dir);
          return { name: e.name, files };
        });

      if (skills.length === 0) {
        return {
          content: [{ type: "text", text: "No skills installed." }],
          details: { success: true, skills: [] },
        };
      }

      const listing = skills.map((s: any) => `- ${s.name}/ (${s.files.join(", ")})`).join("\n");

      return {
        content: [{ type: "text", text: `Installed skills:\n${listing}` }],
        details: { success: true, skills },
      };
    },
  });
}
