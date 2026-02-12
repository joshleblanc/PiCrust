/**
 * Discord Reactions Extension
 * 
 * Allows the agent to react to messages with emojis in Discord.
 * 
 * Tools:
 *   discord_reaction - Add a reaction emoji to a message
 * 
 * Usage:
 *   The agent can call discord_reaction with:
 *   - messageId: The Discord message ID to react to
 *   - emoji: The emoji reaction (unicode or custom emoji)
 * 
 * Example:
 *   discord_reaction(messageId: "123456789", emoji: "👍")
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
    // Tool: discord_reaction
    pi.registerTool({
        name: "discord_reaction",
        label: "Add Discord Reaction",
        description: "Add an emoji reaction to a Discord message. Use this to acknowledge messages, show approval/disapproval, or provide quick feedback.",
        parameters: Type.Object({
            emoji: Type.String({
                description: "The emoji to react with. Can be a unicode emoji (👍, 👀, ✅) or a custom emoji ID (for custom emotes).",
            }),
        }),
        async execute(_toolCallId, params, signal) {
            const messageId = params.messageId?.trim();
            const emoji = params.emoji?.trim();

            if (!emoji) {
                return {
                    content: [{ type: "text", text: "Usage: discord_reaction(emoji: '👍')" }],
                    details: { success: false, error: "emoji is required" },
                };
            }

            // Validate emoji looks reasonable
            if (emoji.length === 0) {
                return {
                    content: [{ type: "text", text: "Emoji cannot be empty" }],
                    details: { success: false, error: "emoji is empty" },
                };
            }

            // Send a custom message that DiscordService will interpret as a reaction
            await pi.sendMessage({
                customType: "discord_reaction",
                content: JSON.stringify({
                    emoji
                }),
                display: false, // Don't show this message in the chat
                details: {
                    success: true,
                    emoji
                }
            });

            return {
                content: [{ type: "text", text: `Reacted with ${emoji} to message ${messageId}` }],
                details: {
                    success: true,
                    messageId,
                    emoji
                },
            };
        },
    });
    
    // Register a message renderer for discord_reaction messages
    // This handles display when the message type is shown in TUI
    pi.registerMessageRenderer("discord_reaction", (message, options, theme) => {
        const { expanded } = options;
        
        let text = theme.fg("accent", "[Discord Reaction] ");
        
        try {
            const details = JSON.parse(message.content);
            text += `Reacted with ${details.emoji} to message ${details.messageId}`;
        } catch {
            text += message.content;
        }
        
        if (expanded && message.details) {
            text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
        }

        return new (require("@mariozechner/pi-tui").Text)(text, 0, 0);
    });
}
