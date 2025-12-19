using System.ComponentModel.DataAnnotations;

namespace EbookReader.Core.Entities;

public class KindleAccount
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid UserId { get; set; }
    
    public User User { get; set; } = null!;

    [Required]
    [MaxLength(500)]
    public string AmazonEmail { get; set; } = string.Empty;

    /// <summary>
    /// Encrypted Amazon password or session cookies
    /// </summary>
    [Required]
    public string EncryptedCredentials { get; set; } = string.Empty;

    /// <summary>
    /// Last successful sync timestamp
    /// </summary>
    public DateTime? LastSyncedAt { get; set; }

    /// <summary>
    /// Last sync error message (if any)
    /// </summary>
    [MaxLength(1000)]
    public string? LastSyncError { get; set; }

    /// <summary>
    /// Whether the Kindle account is currently active
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Amazon marketplace (e.g., "com", "co.uk", "de")
    /// </summary>
    [Required]
    [MaxLength(10)]
    public string Marketplace { get; set; } = "com";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
