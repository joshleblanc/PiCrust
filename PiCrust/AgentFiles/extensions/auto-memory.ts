/**
 * Auto-Memory Extension
 * 
 * Automatically updates MEMORY.md after each session with:
 * - Session summary
 * - User-specific context learned (per-user sections)
 * - Important global context
 * 
 * Message format: <@userId in channel> message
 * User sections are automatically created and updated based on who is talking.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
    const MEMORY_PATH = "MEMORY.md";
    
    // Track user IDs seen in current session
    const userIdsInSession = new Set<string>();
    const userMessages: Map<string, string[]> = new Map();
    
    // Extract user ID from message format: <@123456789 in #channel> message
    function extractUserId(text: string): string | null {
        const match = text.match(/<@(\d+)/);
        return match ? match[1] : null;
    }
    
    // Extract user ID and channel from message
    function parseMessageContext(text: string): { userId: string | null; channel: string | null } {
        const userMatch = text.match(/<@(\d+)/);
        const channelMatch = text.match(/in (.+?)>/);
        
        return {
            userId: userMatch ? userMatch[1] : null,
            channel: channelMatch ? channelMatch[1] : null
        };
    }
    
    pi.on("message_create", async (event) => {
        // Track users from user messages
        if (event.role === "user" && event.content) {
            const content = Array.isArray(event.content) 
                ? event.content.map(c => c.text || "").join("")
                : event.content;
            
            const { userId, channel } = parseMessageContext(content);
            
            if (userId) {
                userIdsInSession.add(userId);
                
                // Track messages per user for summarization
                if (!userMessages.has(userId)) {
                    userMessages.set(userId, []);
                }
                userMessages.get(userId)!.push(content);
            }
        }
    });
    
    pi.on("session_shutdown", async (event) => {
        const messages = event.messages;
        if (!messages || messages.length === 0) return;
        
        // Extract user information from the session
        const sessionUsers = new Map<string, string[]>();
        
        for (const msg of messages) {
            if (msg.role === "user" && msg.content) {
                const content = Array.isArray(msg.content)
                    ? msg.content.map(c => c.text || "").join("")
                    : msg.content;
                
                const { userId } = parseMessageContext(content);
                if (userId) {
                    if (!sessionUsers.has(userId)) {
                        sessionUsers.set(userId, []);
                    }
                    sessionUsers.get(userId)!.push(content);
                }
            }
        }
        
        // Update memory with user-specific info
        await updateMemoryWithUsers(sessionUsers);
    });
    
    async function updateMemoryWithUsers(sessionUsers: Map<string, string[]>) {
        if (sessionUsers.size === 0) return;
        
        try {
            let existingContent = "";
            try {
                const readResult = await pi.callTool("read", {
                    path: MEMORY_PATH
                });
                existingContent = readResult.content?.[0]?.text || "";
            } catch {
                existingContent = getMemoryTemplate();
            }
            
            // Update each user's section
            for (const [userId, userMsgs] of sessionUsers) {
                const summary = await summarizeUserContext(userId, userMsgs);
                if (summary) {
                    existingContent = updateUserSection(existingContent, userId, summary);
                }
            }
            
            // Write updated memory
            await pi.callTool("write", {
                path: MEMORY_PATH,
                content: existingContent
            });
            
        } catch (error) {
            pi.log(`Auto-memory: Failed to update memory: ${error}`);
        }
    }
    
    async function summarizeUserContext(userId: string, messages: string[]): Promise<string | null> {
        if (messages.length < 2) return null;
        
        const prompt = `
Analyze these messages from user @${userId} and extract:
1. Any stated preferences (language, tone, etc.)
2. Projects or topics they're working on
3. Any important context that should be remembered

User messages:
${messages.map(m => `- ${m.slice(0, 300)}`).join("\n")}

Respond with a brief 1-2 sentence summary of what you learned about this user, or "none" if there's nothing notable.`;
        
        try {
            const result = await pi.callTool("memory_summary", { prompt });
            const text = result.content?.[0]?.text || "";
            
            if (text.toLowerCase().includes("none") || text.length < 10) {
                return null;
            }
            
            return text.trim();
        } catch {
            return null;
        }
    }
    
    function updateUserSection(content: string, userId: string, newInfo: string): string {
        const lines = content.split("\n");
        const userSectionHeader = `## User: ${userId}`;
        const updatedLines: string[] = [];
        let foundUserSection = false;
        let inUserSection = false;
        let replaced = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check if we're at the user section
            if (line.startsWith(userSectionHeader)) {
                foundUserSection = true;
                inUserSection = true;
                updatedLines.push(line);
                
                // Replace existing content in this section until next ## header or end
                const timestamp = new Date().toISOString().split("T")[0];
                updatedLines.push(`- **${timestamp}**: ${newInfo}`);
                replaced = true;
                continue;
            }
            
            // End of user section
            if (inUserSection && line.startsWith("## ")) {
                inUserSection = false;
            }
            
            // Skip old entries if we replaced
            if (inUserSection && replaced && line.startsWith("- ")) {
                continue;
            }
            
            // Don't add duplicate entries
            if (line.includes(newInfo)) {
                continue;
            }
            
            updatedLines.push(line);
        }
        
        // If user section doesn't exist, add it
        if (!foundUserSection) {
            // Find a good place to insert - after "## User Preferences" or before "## Notes"
            let insertIndex = updatedLines.findIndex(l => l.startsWith("## Notes"));
            if (insertIndex === -1) {
                insertIndex = updatedLines.length;
            }
            
            updatedLines.splice(insertIndex, 0, "");
            updatedLines.splice(insertIndex + 1, 0, userSectionHeader);
            updatedLines.splice(insertIndex + 2, 0, `- **${new Date().toISOString().split("T")[0]}**: ${newInfo}`);
        }
        
        return updatedLines.join("\n");
    }
    
    function getMemoryTemplate(): string {
        return `# Memory

_Last updated: ${new Date().toISOString().split("T")[0]}_

This file contains persistent context that survives across pi restarts and sessions.

## Global Preferences

- Multi-user mode: enabled
- All Discord users can interact with the assistant

## User Context

## Notes

---
`;
    }
    
    // Register a command to view memory
    pi.registerCommand("memory", {
        label: "View Memory",
        description: "View persistent memory",
        parameters: Type.Object({}),
        handler: async () => {
            try {
                const readResult = await pi.callTool("read", {
                    path: MEMORY_PATH
                });
                return {
                    content: [{ type: "text", text: readResult.content?.[0]?.text || "No memory found." }],
                    details: {}
                };
            } catch {
                return {
                    content: [{ type: "text", text: "No memory file found." }],
                    details: {}
                };
            }
        }
    });
    
}
