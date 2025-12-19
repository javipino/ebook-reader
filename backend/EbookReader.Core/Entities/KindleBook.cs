using System.ComponentModel.DataAnnotations;

namespace EbookReader.Core.Entities;

/// <summary>
/// Mapping between Kindle ASINs and our Book entities
/// </summary>
public class KindleBook
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid BookId { get; set; }
    
    public Book Book { get; set; } = null!;

    [Required]
    public Guid KindleAccountId { get; set; }
    
    public KindleAccount KindleAccount { get; set; } = null!;

    /// <summary>
    /// Amazon ASIN (unique book identifier)
    /// </summary>
    [Required]
    [MaxLength(20)]
    public string Asin { get; set; } = string.Empty;

    /// <summary>
    /// Last synced reading position from Kindle (0-100)
    /// </summary>
    public int LastKindlePosition { get; set; }

    /// <summary>
    /// Timestamp of last Kindle position update
    /// </summary>
    public DateTime? LastKindlePositionUpdatedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
