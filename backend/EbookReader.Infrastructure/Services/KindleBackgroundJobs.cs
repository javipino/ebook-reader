using EbookReader.Core.Interfaces;
using EbookReader.Infrastructure.Data;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace EbookReader.Infrastructure.Services;

public class KindleBackgroundJobs
{
    private readonly ILogger<KindleBackgroundJobs> _logger;

    public KindleBackgroundJobs(ILogger<KindleBackgroundJobs> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Sync all active Kindle accounts (runs every 6 hours)
    /// </summary>
    [AutomaticRetry(Attempts = 3)]
    public async Task SyncAllKindleAccountsAsync(
        EbookReaderDbContext context,
        IKindleService kindleService)
    {
        _logger.LogInformation("Starting automatic Kindle library sync for all users");

        var activeAccounts = await context.KindleAccounts
            .Where(ka => ka.IsActive)
            .ToListAsync();

        _logger.LogInformation("Found {Count} active Kindle accounts", activeAccounts.Count);

        foreach (var account in activeAccounts)
        {
            try
            {
                _logger.LogInformation("Syncing Kindle library for user {UserId}", account.UserId);
                var result = await kindleService.SyncLibraryAsync(account.UserId);

                if (result.Success)
                {
                    _logger.LogInformation(
                        "Successfully synced Kindle library for user {UserId}: {Added} added, {Updated} updated",
                        account.UserId, result.BooksAdded, result.BooksUpdated);
                }
                else
                {
                    _logger.LogWarning(
                        "Failed to sync Kindle library for user {UserId}: {Error}",
                        account.UserId, result.ErrorMessage);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error syncing Kindle library for user {UserId}", account.UserId);
            }
        }

        _logger.LogInformation("Completed automatic Kindle library sync");
    }

    /// <summary>
    /// Register recurring jobs
    /// </summary>
    public static void RegisterRecurringJobs()
    {
        // Sync all Kindle accounts every 6 hours
        RecurringJob.AddOrUpdate<KindleBackgroundJobs>(
            "sync-kindle-libraries",
            job => job.SyncAllKindleAccountsAsync(null!, null!),
            Cron.Daily, // Change to "0 */6 * * *" for every 6 hours
            new RecurringJobOptions
            {
                TimeZone = TimeZoneInfo.Utc
            });
    }
}
