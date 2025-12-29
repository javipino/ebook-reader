using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using EbookReader.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EbookReader.API.Controllers;

[ApiController]
[Route("api/users/me/settings")]
[Authorize]
public class UserSettingsController : ControllerBase
{
    private readonly EbookReaderDbContext _context;

    public UserSettingsController(EbookReaderDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<UserTtsSettingsDto>> GetMySettings()
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized(new { message = "Invalid JWT token" });
        }

        var user = await _context.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            return NotFound(new { message = "User not found" });
        }

        return Ok(new UserTtsSettingsDto
        {
            PreferredTtsProvider = NormalizeProvider(user.PreferredTtsProvider),
            PreferredAzureVoiceName = user.PreferredAzureVoiceName,
            EnableSsmlEnhancement = user.EnableSsmlEnhancement
        });
    }

    [HttpPut]
    public async Task<ActionResult<UserTtsSettingsDto>> UpdateMySettings([FromBody] UpdateUserTtsSettingsRequest request)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized(new { message = "Invalid JWT token" });
        }

        var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
        {
            return NotFound(new { message = "User not found" });
        }

        var provider = NormalizeProvider(request.PreferredTtsProvider);
        if (provider is not ("elevenlabs" or "azure"))
        {
            return BadRequest(new { message = "Invalid provider. Use 'elevenlabs' or 'azure'." });
        }

        user.PreferredTtsProvider = provider;
        user.PreferredAzureVoiceName = string.IsNullOrWhiteSpace(request.PreferredAzureVoiceName)
            ? null
            : request.PreferredAzureVoiceName.Trim();
        user.EnableSsmlEnhancement = request.EnableSsmlEnhancement;

        await _context.SaveChangesAsync();

        return Ok(new UserTtsSettingsDto
        {
            PreferredTtsProvider = provider,
            PreferredAzureVoiceName = user.PreferredAzureVoiceName,
            EnableSsmlEnhancement = user.EnableSsmlEnhancement
        });
    }

    private bool TryGetUserId(out Guid userId)
    {
        // JwtBearer in ASP.NET can map inbound claim types. In particular, "sub" is often mapped to NameIdentifier.
        // Be robust and accept both.
        var raw =
            User.FindFirstValue(ClaimTypes.NameIdentifier) ??
            User.FindFirstValue(JwtRegisteredClaimNames.Sub) ??
            User.FindFirstValue("sub");

        return Guid.TryParse(raw, out userId);
    }

    private static string NormalizeProvider(string? provider)
    {
        var p = (provider ?? string.Empty).Trim().ToLowerInvariant();
        if (p.Contains("azure")) return "azure";
        return "elevenlabs";
    }
}

public class UserTtsSettingsDto
{
    public string PreferredTtsProvider { get; set; } = "elevenlabs";
    public string? PreferredAzureVoiceName { get; set; }
    public bool EnableSsmlEnhancement { get; set; } = false;
}

public class UpdateUserTtsSettingsRequest
{
    public string PreferredTtsProvider { get; set; } = "elevenlabs";
    public string? PreferredAzureVoiceName { get; set; }
    public bool EnableSsmlEnhancement { get; set; } = false;
}
