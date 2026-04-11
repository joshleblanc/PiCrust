/**
 * Discord Files Extension
 * 
 * Allows the agent to send files to the Discord channel.
 * 
 * Tools:
 *   discord_file - Send a file to the Discord channel
 * 
 * Usage:
 *   The agent can call discord_file with:
 *   - filePath: The path to the file to send
 *   - message: Optional message to include with the file
 * 
 * Example:
 *   discord_file(filePath: "/path/to/image.png", message: "Here's that screenshot you asked for!")
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
    // Tool: discord_file
    pi.registerTool({
        name: "discord_file",
        label: "Send Discord File",
        description: "Send a file to the Discord channel. Use this to share images, documents, code files, or any other files with the user.",
        parameters: Type.Object({
            filePath: Type.String({
                description: "The path to the file to send. Can be an absolute path or relative to the current working directory.",
            }),
            message: Type.Optional(Type.String({
                description: "Optional message to include with the file.",
            })),
        }),
        async execute(_toolCallId, params, signal) {
            const filePath = params.filePath?.trim();
            const message = params.message?.trim();

            if (!filePath) {
                return {
                    content: [{ type: "text", text: "Usage: discord_file(filePath: '/path/to/file.png', message?: 'Optional message')" }],
                    details: { success: false, error: "filePath is required" },
                };
            }

            // Send a custom message that DiscordService will interpret as a file send
            await pi.sendMessage({
                customType: "discord_file",
                content: JSON.stringify({
                    filePath,
                    message: message || null
                }),
                display: false, // Don't show this message in the chat
                details: {
                    success: true,
                    filePath,
                    hasMessage: !!message
                }
            });

            const msgText = message ? ` with message: "${message}"` : "";
            return {
                content: [{ type: "text", text: `Sending file ${filePath}${msgText} to Discord` }],
                details: {
                    success: true,
                    filePath,
                    message
                },
            };
        },
    });
    
    // Register a message renderer for discord_file messages
    // This handles display when the message type is shown in TUI
    pi.registerMessageRenderer("discord_file", (message, options, theme) => {
        const { expanded } = options;
        
        let text = theme.fg("accent", "[Discord File] ");
        
        try {
            const details = JSON.parse(message.content);
            text += `Sending file: ${details.filePath}`;
            if (details.message) {
                text += `\n  Message: "${details.message}"`;
            }
        } catch {
            text += message.content;
        }
        
        if (expanded && message.details) {
            text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
        }

        return new (require("@mariozechner/pi-tui").Text)(text, 0, 0);
    });
}
