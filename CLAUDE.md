# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PiCrust is a containerized personal AI assistant that provides a Discord interface to the [pi](https://github.com/badlogic/pi) coding agent. It features scheduled heartbeats, persistent memory, and Rabbit R1 device gateway support.

## Build Commands

```bash
# Build the project
cd PiCrust && dotnet build

# Run locally (requires pi executable in PATH)
cd PiCrust && dotnet run

# Build Docker image
docker build -t picrust -f PiCrust/Dockerfile PiCrust

# Run with Docker
docker run -d --name picrust \
  -e DISCORD_TOKEN=your_token \
  -e MINIMAX_API_KEY=your_key \
  -e OWNER_ID=your_id \
  -v ~/picrust-data:/home/picrust \
  picrust
```

## Architecture

### Core Services

- **Program.cs** - Application entry point. Sets up dependency injection, binds environment variables to Configuration class, and registers hosted services.
- **DiscordService** - Discord bot implementation. Relays messages between Discord and pi. Handles DMs and mentions. Extracts images from attachments and sends them to pi.
- **PiService** - Manages the pi subprocess in RPC mode. Handles stdin/stdout communication with pi, parses JSON events, and provides methods like `SendPromptAsync`, `SendSteerAsync`, `RestartAsync`.
- **HeartbeatService** - Background service running heartbeat prompts on a configurable interval (default 30 minutes). Sends status updates to Discord when significant.
- **RabbitGatewayService** - WebSocket server for Rabbit R1 device connectivity. Implements OpenClaw-compatible protocol on port 18789.

### Configuration Model

Configuration is bound from environment variables in `Models/Configuration.cs`:
- `DISCORD_TOKEN` - Discord bot token
- `MINIMAX_API_KEY` - AI provider API key
- `PI_CODING_AGENT_DIR` - Working directory for pi (defaults to `/home/picrust`)
- `PI_PROVIDER` / `PI_MODEL` - AI provider and model selection
- `HEARTBEAT_INTERVAL_MINUTES` - Heartbeat frequency (default: 30)
- `RABBIT_GATEWAY_ENABLED` - Enable Rabbit R1 gateway
- `RABBIT_GATEWAY_PORT` - Gateway port (default: 18789)

### Agent Files

The `AgentFiles/` directory contains pi agent configuration that gets copied to `/home/picrust` in the container:

| File | Purpose |
|------|---------|
| `MEMORY.md` | Long-term persistent memory (main session only) |
| `SOUL.md` | Agent identity and personality |
| `HEARTBEAT.md` | Heartbeat prompt template |
| `AGENTS.md` | Multi-agent and group chat behavior |
| `BOOTSTRAP.md` | Initial agent bootstrap instructions |
| `extensions/` | TypeScript extensions (auto-memory, session-manager, etc.) |
| `skills/` | Agent skills |
| `prompts/` | Reusable prompt templates |

### Event Flow

1. Discord message received → `DiscordService.HandleMessageReceivedAsync`
2. DM/mention = direct request with typing indicator and response expected
3. Background channel messages routed with meta-instructions to not respond
4. pi response streams via `PiService.OnEvent` (message_update, agent_end, turn_end)
5. Text responses sent back to Discord channel

### Rabbit R1 Gateway

Implements OpenClaw-compatible WebSocket protocol on port 18789:
- `agent.prompt` / `chat.send` - Send prompts to pi
- `device.list/approve/revoke` - Device management
- `talk.config` - ElevenLabs TTS configuration
- QR code available at `http://<host>:18789/qr`

## Development Notes

- Target framework: .NET 10.0
- Discord library: Discord.Net 3.17.2
- Hosted as BackgroundService implementations
- Event routing: PiService fires events via `OnEvent` delegate; DiscordService and HeartbeatService subscribe
- Image attachments are base64-encoded and sent to pi as image blocks
- Messages exceeding 2000 chars are split into chunks before sending to Discord
