namespace EbookReader.Core.Interfaces;

public interface IKindleService
{
    /// <summary>
    /// Connect a user's Kindle account with session cookies
    /// </summary>
    Task<bool> ConnectWithCookiesAsync(Guid userId, string email, string sessionCookies, string marketplace = "com");

    /// <summary>
    /// Validate if session cookies are still valid
    /// </summary>
    Task<bool> ValidateCookiesAsync(string sessionCookies, string marketplace = "com");

    /// <summary>
    /// Disconnect and remove Kindle account
    /// </summary>
    Task<bool> DisconnectAccountAsync(Guid userId);

    /// <summary>
    /// Get current Kindle account status
    /// </summary>
    Task<KindleAccountStatus?> GetAccountStatusAsync(Guid userId);

    /// <summary>
    /// Sync user's Kindle library (download new books)
    /// </summary>
    Task<KindleSyncResult> SyncLibraryAsync(Guid userId);

    /// <summary>
    /// Sync reading progress for a specific book
    /// </summary>
    Task<bool> SyncReadingProgressAsync(Guid userId, Guid bookId);

    /// <summary>
    /// Push local reading progress to Kindle
    /// </summary>
    Task<bool> PushProgressToKindleAsync(Guid userId, Guid bookId, int position);
}

public class KindleAccountStatus
{
    public bool IsConnected { get; set; }
    public string? Email { get; set; }
    public string? Marketplace { get; set; }
    public DateTime? LastSyncedAt { get; set; }
    public string? LastSyncError { get; set; }
    public int TotalBooks { get; set; }
}

public class KindleSyncResult
{
    public bool Success { get; set; }
    public int BooksAdded { get; set; }
    public int BooksUpdated { get; set; }
    public int ProgressSynced { get; set; }
    public string? ErrorMessage { get; set; }
    public List<string> Errors { get; set; } = new();
}
