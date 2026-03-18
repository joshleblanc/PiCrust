using Discord;
using Discord.WebSocket;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PiCrust.Models;
using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Nodes;

namespace PiCrust.Services;

/// <summary>
/// Discord bot service that relays messages between Discord and pi.
/// Only responds to mentions and DMs (lurk mode), but maintains conversation context.
/// </summary>
public class DiscordService : BackgroundService
{
    private readonly DiscordSocketClient _client;
    private readonly PiService _piClient;
    private readonly ILogger<DiscordService> _logger;
    private readonly Configuration _config;

    // Track the last used channel for system messages (heartbeats, etc.)
    private ISocketMessageChannel? _lastChannel;

    // Event that other services can subscribe to for channel tracking
    public event Action<ISocketMessageChannel>? OnChannelUsed;

    // Track whether a runtime reload is needed after the current agent run
    private bool _reloadNeeded = false;

    // Queue to ensure only one direct message is processed at a time
    // This prevents race conditions where concurrent DMs would have responses delivered to wrong users
    private readonly SemaphoreSlim _directMessageLock = new(1, 1);

    public DiscordService(
        DiscordSocketClient client,
        PiService piClient,
        ILogger<DiscordService> logger,
        Configuration config)
    {
        _client = client;
        _piClient = piClient;
        _logger = logger;
        _config = config;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Discord service starting (lurk mode with context)...");

        _client.Log += msg =>
        {
            _logger.LogDebug("Discord: {Message}", msg.Message);
            return Task.CompletedTask;
        };

        _client.MessageReceived += HandleMessageReceivedAsync;
        _client.Ready += () =>
        {
            _logger.LogInformation("Discord bot connected as {Username}", _client.CurrentUser.Username);
            return Task.CompletedTask;
        };

        // Subscribe to pi events
        _piClient.OnEvent += HandlePiEventAsync;

        // Login and start
        await _client.LoginAsync(TokenType.Bot, _config.DiscordToken, true);
        await _client.StartAsync();

        // Keep running until cancelled
        await Task.Delay(-1, stoppingToken);
    }

    private async Task HandleMessageReceivedAsync(SocketMessage message)
    {
        try
        {
            // Ignore own messages
            if (message.Author.Id == _client.CurrentUser?.Id) return;

            // Only handle user messages
            if (message is not SocketUserMessage userMessage) return;

            // Get channel reference before we lose it
            ISocketMessageChannel? channel = userMessage.Channel;

            // Track the last used channel for system messages (heartbeats, etc.)
            _lastChannel = channel;
            OnChannelUsed?.Invoke(channel);

            var channelName = GetChannelName(channel);
            var isDirect = IsDirectRequest(userMessage);

            if (isDirect)
            {
                _logger.LogInformation("Received DIRECT message from {User} ({UserId}) in {Channel}: {Content}",
                    message.Author.Username,
                    message.Author.Id,
                    channelName,
                    Truncate(message.Content, 100));
            }
            else
            {
                _logger.LogDebug("Background: {User} in {Channel}: {Content}",
                    message.Author.Username,
                    channelName,
                    Truncate(message.Content, 100));
            }

            var images = await ExtractImagesAsync(userMessage);

            if (isDirect)
            {
                // Wait for any in-progress direct message to complete before processing
                // This ensures responses go to the correct user
                await _directMessageLock.WaitAsync();
                try
                {
                    // Show typing indicator and send the message
                    using var typing = channel.EnterTypingState();
                    var attributedMessage = $"<@{message.Author.Id} in {channelName}> {message.Content}";
                    await _piClient.SendPromptFireAndForgetAsync(attributedMessage, images);
                }
                catch (PiService.PiNotRunningException ex)
                {
                    // pi was not running - the service has triggered a restart
                    // Release the semaphore and notify the user
                    _directMessageLock.Release();
                    _logger.LogWarning("Pi was not running, restart triggered: {Message}", ex.Message);
                    await channel.SendMessageAsync("Sorry, I was restarting. Please try again in a moment.");
                    return;
                }
                catch (Exception)
                {
                    _directMessageLock.Release();
                    throw;
                }
            }
            else
            {
                // Background message - send for context but DON'T expect a response
                // Use meta instruction format that pi understands to not respond
                var backgroundMessage = $"<meta>Background channel message — DO NOT derail from your current task and continue work / responding. Acknowledge only if directly relevant. If you just sent a final response, respond with only one word NULL unless this message should provoke a direct followup.</meta>\n\n<@{message.Author.Id} in {channelName}> {message.Content}\n\n<meta>Before reacting in any way, consider silently whether to adjust course in any way or continue in your current trajectory.</meta>";

                // Background messages always go through as prompts (pi will respond with NULL per meta instructions)
                await _piClient.SendPromptFireAndForgetAsync(backgroundMessage, images);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling message from {User}: {Message}", message.Author.Username, Truncate(message.Content, 100));
        }
    }

    private string GetChannelName(ISocketMessageChannel channel)
    {
        if (channel is SocketDMChannel dm)
        {
            return $"DM with {dm.Recipient.Username}";
        }
        if (channel is SocketTextChannel tc)
        {
            return $"#{tc.Name} in {tc.Guild.Name}";
        }
        return channel.Name ?? "unknown";
    }

    /// <summary>
    /// Determines if this is a direct request (DM or mention) vs background.
    /// </summary>
    private bool IsDirectRequest(SocketUserMessage message)
    {
        // DM is always direct
        if (message.Channel is SocketDMChannel)
        {
            return true;
        }
        
        // Check if the bot was mentioned in a text channel
        if (message.Channel is SocketTextChannel)
        {
            var mentions = message.MentionedUsers;
            if (mentions.Any(u => u.Id == _client.CurrentUser?.Id))
            {
                return true;
            }
            
            // Check for @everyone or @here
            if (message.MentionedEveryone)
            {
                return true;
            }
        }
        
        return false;
    }

    private async Task<List<PiImage>> ExtractImagesAsync(SocketUserMessage message)
    {
        var images = new List<PiImage>();

        foreach (var attachment in message.Attachments)
        {
            if (IsImage(attachment.Filename))
            {
                try
                {
                    var httpClient = new HttpClient();
                    var data = await httpClient.GetByteArrayAsync(attachment.Url);
                    var base64 = Convert.ToBase64String(data);
                    var mimeType = GetMimeType(attachment.Filename);

                    images.Add(new PiImage(base64, mimeType));
                    _logger.LogDebug("Loaded image: {Filename}", attachment.Filename);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to load image: {Filename}", attachment.Filename);
                }
            }
        }

        return images;
    }

    private async Task HandleTurnEndAsync(JsonNode data)
    {
        var message = data["message"];
        if (message == null) return;

        if (message["role"]?.GetValue<string>() != "assistant")
        {
            return;
        }

        var customType = message["customType"]?.GetValue<string>();
        if (customType == "discord_reaction")
        {
            await ProcessDiscordReactionMessageAsync(message);
            return;
        }

        var content = message["content"]?.AsArray();
        var text = content?.FirstOrDefault(c => c?["type"]?.GetValue<string>() == "text");
        if (text == null)
        {
            return;
        }

        var textContent = text["text"]?.GetValue<string>();
        if (textContent == null)
        {
            return;
        }

        // Skip responses that are "NULL" - this happens when the LLM follows
        // the meta instruction to not respond to background messages
        if (string.Equals(textContent.Trim(), "NULL", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogDebug("Skipping NULL response from LLM");
            return;
        }

        // Send response to the channel that initiated this direct message
        // The semaphore ensures only one direct message is in flight at a time,
        // so _lastChannel will always be the correct channel
        if (_lastChannel != null)
        {
            await SendMessageToChannelAsync(_lastChannel, textContent);
        }
    }

    private async Task HandlePiEventAsync(PiEvent evt)
    {
        switch (evt.Type)
        {
            case "message_update":
                break;
            case "agent_end":
                await HandleAgentEndAsync(evt.Data);
                break;
            case "turn_end":
                await HandleTurnEndAsync(evt.Data);
                break;
            case "tool_execution_start":
            case "tool_execution_end":
                _logger.LogDebug("Tool execution: {Tool}", evt.Data["toolName"]);
                break;
        }
    }

    private async Task HandleAgentEndAsync(JsonNode data)
    {
        // Release the semaphore to allow the next queued direct message to proceed
        // This must be done before any async operations to prevent deadlocks
        _directMessageLock.Release();

        if (_reloadNeeded)
        {
            _reloadNeeded = false;
            _logger.LogInformation("Package operation detected, triggering runtime reload");

            var channel = _lastChannel;
            _ = Task.Run(async () =>
            {
                try
                {
                    await _piClient.RestartAsync();

                    if (channel != null)
                    {
                        await channel.SendMessageAsync("Runtime reloaded. Extensions are up to date.");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to trigger runtime reload");
                }
            });
        }
    }

    private async Task ProcessDiscordReactionMessageAsync(JsonNode message)
    {
        try
        {
            var content = message["content"]?.GetValue<string>();
            if (string.IsNullOrEmpty(content))
            {
                _logger.LogDebug("Discord reaction message has no content");
                return;
            }

            var reactionData = JsonNode.Parse(content);
            if (reactionData == null)
            {
                _logger.LogDebug("Failed to parse Discord reaction data");
                return;
            }

            var emoji = reactionData["emoji"]?.GetValue<string>();

            // We need the original message to react to - this is a limitation
            // For now, log that we received a reaction request
            _logger.LogDebug("Discord reaction requested: {Emoji}", emoji);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process Discord reaction message");
        }
    }

    private async Task SendMessageToChannelAsync(ISocketMessageChannel channel, string response)
    {
        const int maxLength = 2000;
        
        if (response.Length <= maxLength)
        {
            await channel.SendMessageAsync(response);
            
            var channelDesc = channel is SocketDMChannel ? "DM" : $"channel {(channel as SocketTextChannel)?.Name ?? channel.Id.ToString()}";
            _logger.LogDebug("Sent response to {Channel}", channelDesc);
        }
        else
        {
            var chunks = SplitMessage(response, maxLength);
            foreach (var chunk in chunks)
            {
                await channel.SendMessageAsync(chunk);
                _logger.LogDebug("Sent chunk ({Length} chars)", chunk.Length);
                await Task.Delay(100);
            }
        }
    }

    private static IEnumerable<string> SplitMessage(string message, int maxLength)
    {
        var lines = message.Split('\n');
        var currentChunk = new StringBuilder();

        foreach (var line in lines)
        {
            if (currentChunk.Length + line.Length + 1 <= maxLength)
            {
                if (currentChunk.Length > 0)
                    currentChunk.Append('\n');
                currentChunk.Append(line);
            }
            else
            {
                if (currentChunk.Length > 0)
                    yield return currentChunk.ToString();
                currentChunk = new StringBuilder(line);
            }
        }

        if (currentChunk.Length > 0)
            yield return currentChunk.ToString();
    }

    private static bool IsImage(string filename)
    {
        var ext = Path.GetExtension(filename).ToLowerInvariant();
        return ext is ".png" or ".jpg" or ".jpeg" or ".gif" or ".webp" or ".bmp";
    }

    private static string GetMimeType(string filename)
    {
        var ext = Path.GetExtension(filename).ToLowerInvariant();
        return ext switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".bmp" => "image/bmp",
            _ => "image/png"
        };
    }

    private static string Truncate(string s, int maxLength) =>
        string.IsNullOrEmpty(s) || s.Length <= maxLength ? s : s[..maxLength] + "...";
}
