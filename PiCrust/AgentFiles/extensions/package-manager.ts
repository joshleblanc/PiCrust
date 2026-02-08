/**
 * Package Manager Extension
 *
 * Lets the agent install pi packages into itself at runtime using the
 * `pi install` CLI. Supports npm, git, and https sources.
 *
 * Commands:
 *   /install <source>    — install a pi package
 *   /uninstall <source>  — remove a pi package
 *   /packages            — list installed pi packages
 *   /update              — update all installed packages
 *
 * Source formats:
 *   npm:@scope/name      — from npm registry
 *   npm:@scope/name@1.2  — pinned version
 *   git:github.com/u/r   — from git
 *   git:github.com/u/r@v — tag or commit
 *   https://github.com/… — shorthand git URL
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
    // /install <source>
    pi.registerCommand("install", {
        description: "Install a pi package (e.g. /install https://github.com/user/repo)",
        handler: async (args, ctx) => {
            const source = args.trim();
            if (!source) {
                ctx.ui.notify("Usage: /install <source>  (npm:pkg, git:repo, or https URL)", "warning");
                return;
            }

            if (!isValidSource(source)) {
                ctx.ui.notify("Invalid source. Use npm:pkg, git:github.com/user/repo, or an https URL.", "error");
                return;
            }

            ctx.ui.notify(`Installing ${source}...`, "info");

            try {
                const result = await pi.callTool("bash", {
                    command: `pi install ${source} 2>&1`
                });

                const output = result.content?.[0]?.text || "";

                if (output.toLowerCase().includes("error")) {
                    ctx.ui.notify(`Install failed — check logs`, "error");
                } else {
                    ctx.ui.notify(`Installed ${source}`, "success");
                }
            } catch (error) {
                ctx.ui.notify(`Install failed: ${error}`, "error");
            }
        },
    });

    // /uninstall <source>
    pi.registerCommand("uninstall", {
        description: "Remove a pi package (e.g. /uninstall npm:@scope/pkg)",
        handler: async (args, ctx) => {
            const source = args.trim();
            if (!source) {
                ctx.ui.notify("Usage: /uninstall <source>", "warning");
                return;
            }

            ctx.ui.notify(`Removing ${source}...`, "info");

            try {
                const result = await pi.callTool("bash", {
                    command: `pi remove ${source} 2>&1`
                });

                const output = result.content?.[0]?.text || "";

                if (output.toLowerCase().includes("error")) {
                    ctx.ui.notify(`Remove failed — check logs`, "error");
                } else {
                    ctx.ui.notify(`Removed ${source}`, "success");
                }
            } catch (error) {
                ctx.ui.notify(`Remove failed: ${error}`, "error");
            }
        },
    });

    // /packages — list installed
    pi.registerCommand("packages", {
        description: "List installed pi packages",
        handler: async (_args, ctx) => {
            try {
                const result = await pi.callTool("bash", {
                    command: `pi list 2>&1`
                });

                const output = result.content?.[0]?.text || "";

                if (!output.trim()) {
                    ctx.ui.notify("No packages installed yet.", "info");
                } else {
                    ctx.ui.notify(output.trim(), "info");
                }
            } catch (error) {
                ctx.ui.notify(`Failed to list packages: ${error}`, "error");
            }
        },
    });

    // /update — update all packages
    pi.registerCommand("update", {
        description: "Update all installed pi packages (skips pinned versions)",
        handler: async (args, ctx) => {
            const source = args.trim();
            const cmd = source ? `pi update ${source} 2>&1` : `pi update 2>&1`;

            ctx.ui.notify("Updating packages...", "info");

            try {
                const result = await pi.callTool("bash", { command: cmd });
                const output = result.content?.[0]?.text || "";

                if (output.toLowerCase().includes("error")) {
                    ctx.ui.notify(`Update failed — check logs`, "error");
                } else {
                    ctx.ui.notify("Packages updated", "success");
                }
            } catch (error) {
                ctx.ui.notify(`Update failed: ${error}`, "error");
            }
        },
    });

}

/** Validate that the source looks like a valid pi package specifier. */
function isValidSource(input: string): boolean {
    // npm:@scope/name or npm:name, optionally with @version
    if (/^npm:(@[\w\-\.]+\/)?[\w\-\.]+(@[\w\-\.\^~>=<*]+)?$/.test(input)) return true;
    // git:github.com/user/repo, optionally with @ref
    if (/^git:[\w\-\.]+\/[\w\-\.]+\/[\w\-\.]+((@|#)[\w\-\.\/]+)?$/.test(input)) return true;
    // https://github.com/user/repo style URLs
    if (/^https?:\/\/[\w\-\.]+\/[\w\-\.]+\/[\w\-\.]+(\.git)?/.test(input)) return true;
    return false;
}
