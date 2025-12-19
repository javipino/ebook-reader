using EbookReader.Core.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace EbookReader.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class KindleController : ControllerBase
{
    private readonly IKindleService _kindleService;
    private readonly ILogger<KindleController> _logger;

    public KindleController(IKindleService kindleService, ILogger<KindleController> logger)
    {
        _kindleService = kindleService;
        _logger = logger;
    }

    private Guid GetUserId()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.Parse(userIdClaim ?? throw new UnauthorizedAccessException());
    }

    /// <summary>
    /// Get Kindle account status
    /// </summary>
    [HttpGet("status")]
    public async Task<ActionResult<KindleAccountStatus>> GetStatus()
    {
        var userId = GetUserId();
        var status = await _kindleService.GetAccountStatusAsync(userId);

        if (status == null)
        {
            return Ok(new { isConnected = false });
        }

        return Ok(status);
    }

    /// <summary>
    /// Connect Kindle account using session cookies
    /// </summary>
    [HttpPost("connect")]
    public async Task<ActionResult> ConnectAccount([FromBody] ConnectKindleRequest request)
    {
        if (string.IsNullOrEmpty(request.Email) || string.IsNullOrEmpty(request.SessionCookies))
        {
            return BadRequest(new { message = "Email and session cookies are required" });
        }

        var userId = GetUserId();
        var success = await _kindleService.ConnectWithCookiesAsync(
            userId,
            request.Email,
            request.SessionCookies,
            request.Marketplace ?? "com"
        );

        if (!success)
        {
            return BadRequest(new { message = "Failed to connect Kindle account. Please verify your cookies are valid and not expired." });
        }

        return Ok(new { message = "Kindle account connected successfully" });
    }

    /// <summary>
    /// Validate cookies by testing them against Amazon
    /// </summary>
    [HttpPost("validate-cookies")]
    public async Task<ActionResult> ValidateCookies([FromBody] ValidateCookiesRequest request)
    {
        if (string.IsNullOrEmpty(request.SessionCookies))
        {
            return BadRequest(new { message = "Session cookies are required" });
        }

        var isValid = await _kindleService.ValidateCookiesAsync(request.SessionCookies, request.Marketplace ?? "com");

        return Ok(new { valid = isValid });
    }

    /// <summary>
    /// Disconnect Kindle account
    /// </summary>
    [HttpDelete("disconnect")]
    public async Task<ActionResult> DisconnectAccount()
    {
        var userId = GetUserId();
        var success = await _kindleService.DisconnectAccountAsync(userId);

        if (!success)
        {
            return NotFound(new { message = "No Kindle account found" });
        }

        return Ok(new { message = "Kindle account disconnected successfully" });
    }

    /// <summary>
    /// Sync Kindle library (fetch new books and update existing ones)
    /// </summary>
    [HttpPost("sync")]
    public async Task<ActionResult<KindleSyncResult>> SyncLibrary()
    {
        var userId = GetUserId();
        var result = await _kindleService.SyncLibraryAsync(userId);

        if (!result.Success)
        {
            return BadRequest(result);
        }

        return Ok(result);
    }

    /// <summary>
    /// Sync reading progress for a specific book
    /// </summary>
    [HttpPost("sync/progress/{bookId}")]
    public async Task<ActionResult> SyncProgress(Guid bookId)
    {
        var userId = GetUserId();
        var success = await _kindleService.SyncReadingProgressAsync(userId, bookId);

        if (!success)
        {
            return BadRequest(new { message = "Failed to sync reading progress" });
        }

        return Ok(new { message = "Reading progress synced successfully" });
    }

    /// <summary>
    /// Push local reading progress to Kindle
    /// </summary>
    [HttpPost("push/progress/{bookId}")]
    public async Task<ActionResult> PushProgress(Guid bookId, [FromBody] PushProgressRequest request)
    {
        var userId = GetUserId();
        var success = await _kindleService.PushProgressToKindleAsync(userId, bookId, request.Position);

        if (!success)
        {
            return BadRequest(new { message = "Failed to push reading progress to Kindle" });
        }

        return Ok(new { message = "Reading progress pushed to Kindle successfully" });
    }
}

public record ConnectKindleRequest(string Email, string SessionCookies, string? Marketplace);
public record ValidateCookiesRequest(string SessionCookies, string? Marketplace);
public record PushProgressRequest(int Position);
