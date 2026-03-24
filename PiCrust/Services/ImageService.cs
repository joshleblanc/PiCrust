using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using PiCrust.Models;

namespace PiCrust.Services;

/// <summary>
/// Service for MiniMax image generation API calls (T2I and I2I).
/// </summary>
public class ImageService(
    ILogger<ImageService> logger,
    Configuration config) : IImageService
{
    private readonly ILogger<ImageService> _logger = logger;
    private readonly Configuration _config = config;

    private const string ApiUrl = "https://api.minimax.io/v1/image_generation";
    private static readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(120) // Image generation can take time
    };

    public async Task<ImageGenerationResult> GenerateImageAsync(
        string prompt,
        string? aspectRatio = null,
        int? samples = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_config.MiniMaxApiKey))
        {
            return new ImageGenerationResult
            {
                Success = false,
                Error = "MINIMAX_API_KEY not configured"
            };
        }

        try
        {
            var request = new MiniMaxImageRequest
            {
                Model = "image-01",
                Prompt = prompt,
                AspectRatio = aspectRatio ?? "1:1",
                Samples = samples ?? 1
            };

            var response = await _httpClient.PostAsJsonAsync(
                ApiUrl,
                request,
                cancellationToken);

            return await HandleResponseAsync(response, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate image");
            return new ImageGenerationResult
            {
                Success = false,
                Error = ex.Message
            };
        }
    }

    public async Task<ImageGenerationResult> GenerateImageVariationAsync(
        string imageReference,
        string prompt,
        string? aspectRatio = null,
        int? samples = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_config.MiniMaxApiKey))
        {
            return new ImageGenerationResult
            {
                Success = false,
                Error = "MINIMAX_API_KEY not configured"
            };
        }

        try
        {
            // Determine if imageReference is base64 or URL
            var isBase64 = imageReference.StartsWith("data:") || imageReference.Length > 500;

            var request = new MiniMaxImageRequest
            {
                Model = "image-01",
                Prompt = prompt,
                AspectRatio = aspectRatio ?? "1:1",
                Samples = samples ?? 1,
                SubjectReference = new[]
                {
                    new SubjectReference
                    {
                        Type = isBase64 ? "base64" : "url",
                        ImageFile = imageReference
                    }
                }
            };

            var response = await _httpClient.PostAsJsonAsync(
                ApiUrl,
                request,
                cancellationToken);

            return await HandleResponseAsync(response, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate image variation");
            return new ImageGenerationResult
            {
                Success = false,
                Error = ex.Message
            };
        }
    }

    private async Task<ImageGenerationResult> HandleResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogError("MiniMax API error: {StatusCode} - {Error}", response.StatusCode, errorContent);
            return new ImageGenerationResult
            {
                Success = false,
                Error = $"API error: {response.StatusCode}"
            };
        }

        var result = await response.Content.ReadFromJsonAsync<MiniMaxImageResponse>(cancellationToken);

        if (result?.Data == null || result.Data.Count == 0)
        {
            return new ImageGenerationResult
            {
                Success = false,
                Error = "No image data returned"
            };
        }

        return new ImageGenerationResult
        {
            Success = true,
            ImageUrl = result.Data[0].Url,
            Base64 = result.Data[0].Base64,
            RevisedPrompt = result.Data[0].RevisedPrompt
        };
    }
}

// Request model
public class MiniMaxImageRequest
{
    [JsonPropertyName("model")]
    public string Model { get; set; } = "image-01";

    [JsonPropertyName("prompt")]
    public string Prompt { get; set; } = string.Empty;

    [JsonPropertyName("aspect_ratio")]
    public string AspectRatio { get; set; } = "1:1";

    [JsonPropertyName("response_format")]
    public string ResponseFormat { get; set; } = "url";

    [JsonPropertyName("samples")]
    public int Samples { get; set; } = 1;

    [JsonPropertyName("subject_reference")]
    public SubjectReference[]? SubjectReference { get; set; }

    [JsonPropertyName("prompt_optimizer")]
    public bool PromptOptimizer { get; set; } = false;
}

public class SubjectReference
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "url";

    [JsonPropertyName("image_file")]
    public string ImageFile { get; set; } = string.Empty;
}

// Response model
public class MiniMaxImageResponse
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("data")]
    public List<ImageData> Data { get; set; } = new();

    [JsonPropertyName("metadata")]
    public ImageMetadata Metadata { get; set; } = new();

    [JsonPropertyName("base_resp")]
    public BaseResp BaseResp { get; set; } = new();
}

public class ImageData
{
    [JsonPropertyName("url")]
    public string? Url { get; set; }

    [JsonPropertyName("base64")]
    public string? Base64 { get; set; }

    [JsonPropertyName("revised_prompt")]
    public string? RevisedPrompt { get; set; }
}

public class ImageMetadata
{
    [JsonPropertyName("success_count")]
    public int SuccessCount { get; set; }

    [JsonPropertyName("failed_count")]
    public int FailedCount { get; set; }
}

public class BaseResp
{
    [JsonPropertyName("status_code")]
    public int StatusCode { get; set; }

    [JsonPropertyName("status_msg")]
    public string StatusMsg { get; set; } = string.Empty;
}

// Result model
public class ImageGenerationResult
{
    public bool Success { get; set; }
    public string? ImageUrl { get; set; }
    public string? Base64 { get; set; }
    public string? RevisedPrompt { get; set; }
    public string? Error { get; set; }
}

// Interface for DI
public interface IImageService
{
    Task<ImageGenerationResult> GenerateImageAsync(
        string prompt,
        string? aspectRatio = null,
        int? samples = null,
        CancellationToken cancellationToken = default);

    Task<ImageGenerationResult> GenerateImageVariationAsync(
        string imageReference,
        string prompt,
        string? aspectRatio = null,
        int? samples = null,
        CancellationToken cancellationToken = default);
}
