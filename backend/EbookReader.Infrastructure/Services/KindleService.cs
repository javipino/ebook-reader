using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using EbookReader.Core.Entities;
using EbookReader.Core.Interfaces;
using EbookReader.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EbookReader.Infrastructure.Services;

public class KindleService : IKindleService
{
    private readonly EbookReaderDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly ILogger<KindleService> _logger;
    private readonly IBookService _bookService;
    private readonly HttpClient _httpClient;
    private readonly string _encryptionKey;

    public KindleService(
        EbookReaderDbContext context,
        IConfiguration configuration,
        ILogger<KindleService> logger,
        IBookService bookService,
        IHttpClientFactory httpClientFactory)
    {
        _context = context;
        _configuration = configuration;
        _logger = logger;
        _bookService = bookService;
        _httpClient = httpClientFactory.CreateClient();
        _encryptionKey = configuration["Kindle:EncryptionKey"] ?? throw new InvalidOperationException("Kindle encryption key not configured");
    }

    public async Task<bool> ConnectWithCookiesAsync(Guid userId, string email, string sessionCookies, string marketplace = "com")
    {
        try
        {
            // Validate cookies first
            if (!await ValidateCookiesAsync(sessionCookies, marketplace))
            {
                _logger.LogWarning("Invalid or expired cookies provided for user {UserId}", userId);
                return false;
            }

            // Encrypt the cookies for storage
            var encryptedCredentials = EncryptCredentials(sessionCookies);

            // Check if account already exists
            var existingAccount = await _context.KindleAccounts
                .FirstOrDefaultAsync(ka => ka.UserId == userId);

            if (existingAccount != null)
            {
                // Update existing account
                existingAccount.AmazonEmail = email;
                existingAccount.EncryptedCredentials = encryptedCredentials;
                existingAccount.Marketplace = marketplace;
                existingAccount.IsActive = true;
                existingAccount.LastSyncError = null;
                existingAccount.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                // Create new account
                var kindleAccount = new KindleAccount
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    AmazonEmail = email,
                    EncryptedCredentials = encryptedCredentials,
                    Marketplace = marketplace,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                _context.KindleAccounts.Add(kindleAccount);
            }

            await _context.SaveChangesAsync();
            
            _logger.LogInformation("Successfully connected Kindle account for user {UserId}", userId);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error connecting Kindle account for user {UserId}", userId);
            return false;
        }
    }

    public async Task<bool> ValidateCookiesAsync(string sessionCookies, string marketplace = "com")
    {
        try
        {
            var baseUrl = $"https://www.amazon.{marketplace}";
            var handler = new HttpClientHandler();
            var cookieContainer = new CookieContainer();
            
            // Parse cookies - support both JSON format and cookie string format
            var cookies = ParseCookies(sessionCookies);
            if (cookies == null || cookies.Count == 0)
            {
                _logger.LogWarning("No valid cookies found in input");
                return false;
            }

            foreach (var cookie in cookies)
            {
                try
                {
                    cookieContainer.Add(new Uri(baseUrl), new Cookie(cookie.Key, cookie.Value));
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to add cookie {Name}", cookie.Key);
                }
            }
            
            handler.CookieContainer = cookieContainer;
            using var client = new HttpClient(handler);
            client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
            client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8");
            client.DefaultRequestHeaders.Add("Accept-Language", "en-US,en;q=0.5");

            // Try to access personal documents page (this requires authentication)
            var testUrl = $"{baseUrl}/hz/mycd/digital-console/contentlist/pdocs/dateDsc/";
            _logger.LogInformation("Testing cookies with URL: {Url}", testUrl);
            
            var response = await client.GetAsync(testUrl);
            var content = await response.Content.ReadAsStringAsync();
            
            _logger.LogInformation("Response status: {Status}, Content length: {Length}, URL: {Url}", 
                response.StatusCode, content.Length, response.RequestMessage?.RequestUri);

            // Check if we're logged in:
            // 1. Response is successful
            // 2. Content doesn't contain login/signin indicators
            // 3. Content contains expected elements from the digital console
            bool hasLoginIndicators = content.Contains("ap_email") || 
                                     content.Contains("ap_password") ||
                                     content.Contains("auth-workflow") ||
                                     content.Contains("\"signIn\"") ||
                                     content.Contains("signin-heading");
            
            bool hasConsoleIndicators = content.Contains("mycd") || 
                                       content.Contains("digital-console") ||
                                       content.Contains("contentlist") ||
                                       content.Contains("pdocs") ||
                                       content.Contains("navbar-mycd") ||
                                       content.Contains("myx-account-settings");
            
            // Consider valid if we got a response, no login page, and we're not being redirected
            bool isLoggedIn = response.IsSuccessStatusCode && 
                             !hasLoginIndicators &&
                             (hasConsoleIndicators || response.RequestMessage?.RequestUri?.AbsolutePath.Contains("mycd") == true);
            
            if (!isLoggedIn)
            {
                _logger.LogWarning("Cookie validation failed. HasLogin: {HasLogin}, HasConsole: {HasConsole}, Status: {Status}", 
                    hasLoginIndicators, hasConsoleIndicators, response.StatusCode);
                
                // Log a snippet of the response for debugging
                var snippet = content.Length > 500 ? content.Substring(0, 500) : content;
                _logger.LogDebug("Response snippet: {Snippet}", snippet);
            }
            
            _logger.LogInformation("Cookie validation result: {IsValid} for marketplace {Marketplace}", isLoggedIn, marketplace);
            return isLoggedIn;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error validating cookies for marketplace {Marketplace}", marketplace);
            return false;
        }
    }

    private Dictionary<string, string>? ParseCookies(string input)
    {
        var cookies = new Dictionary<string, string>();
        
        try
        {
            var trimmedInput = input.TrimStart();
            
            // Try JSON array format first (from browser extensions like EditThisCookie)
            // Format: [{"name": "cookie1", "value": "val1"}, ...]
            if (trimmedInput.StartsWith("["))
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var cookieArray = JsonSerializer.Deserialize<List<CookieDto>>(input, options);
                
                if (cookieArray != null)
                {
                    foreach (var cookie in cookieArray)
                    {
                        if (!string.IsNullOrEmpty(cookie.Name) && !string.IsNullOrEmpty(cookie.Value))
                        {
                            // Remove quotes from value if present
                            var value = cookie.Value.Trim('"');
                            cookies[cookie.Name] = value;
                        }
                    }
                    
                    _logger.LogInformation("Parsed {Count} cookies from JSON array format", cookies.Count);
                    return cookies.Count > 0 ? cookies : null;
                }
            }
            
            // Try JSON object format (simple key-value pairs)
            // Format: {"cookie1": "val1", "cookie2": "val2"}
            if (trimmedInput.StartsWith("{"))
            {
                var cookieDict = JsonSerializer.Deserialize<Dictionary<string, string>>(input);
                if (cookieDict != null && cookieDict.Count > 0)
                {
                    _logger.LogInformation("Parsed {Count} cookies from JSON object format", cookieDict.Count);
                    return cookieDict;
                }
            }
            
            // Try cookie string format (from browser developer tools)
            // Format: "name1=value1; name2=value2; ..."
            var pairs = input.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var pair in pairs)
            {
                var parts = pair.Split(new[] { '=' }, 2);
                if (parts.Length == 2)
                {
                    var name = parts[0].Trim();
                    var value = parts[1].Trim().Trim('"');
                    if (!string.IsNullOrEmpty(name))
                    {
                        cookies[name] = value;
                    }
                }
            }
            
            if (cookies.Count > 0)
            {
                _logger.LogInformation("Parsed {Count} cookies from string format", cookies.Count);
            }
            
            return cookies.Count > 0 ? cookies : null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse cookies");
            return null;
        }
    }

    public async Task<bool> DisconnectAccountAsync(Guid userId)
    {
        var account = await _context.KindleAccounts
            .FirstOrDefaultAsync(ka => ka.UserId == userId);

        if (account == null)
            return false;

        _context.KindleAccounts.Remove(account);
        await _context.SaveChangesAsync();

        _logger.LogInformation("Disconnected Kindle account for user {UserId}", userId);
        return true;
    }

    public async Task<KindleAccountStatus?> GetAccountStatusAsync(Guid userId)
    {
        var account = await _context.KindleAccounts
            .FirstOrDefaultAsync(ka => ka.UserId == userId);

        if (account == null)
            return null;

        var bookCount = await _context.KindleBooks
            .CountAsync(kb => kb.KindleAccountId == account.Id);

        return new KindleAccountStatus
        {
            IsConnected = account.IsActive,
            Email = account.AmazonEmail,
            Marketplace = account.Marketplace,
            LastSyncedAt = account.LastSyncedAt,
            LastSyncError = account.LastSyncError,
            TotalBooks = bookCount
        };
    }

    public async Task<KindleSyncResult> SyncLibraryAsync(Guid userId)
    {
        var result = new KindleSyncResult { Success = false };

        try
        {
            var account = await _context.KindleAccounts
                .FirstOrDefaultAsync(ka => ka.UserId == userId && ka.IsActive);

            if (account == null)
            {
                result.ErrorMessage = "No active Kindle account found";
                return result;
            }

            // Decrypt credentials
            var sessionCookies = DecryptCredentials(account.EncryptedCredentials);

            // Fetch personal documents from Kindle (not DRM protected books)
            var kindleBooks = await FetchKindleLibraryAsync(sessionCookies, account.Marketplace);
            
            _logger.LogInformation("Found {Count} documents in Kindle library for user {UserId}", 
                kindleBooks.Count, userId);

            // Check existing books once before loop
            var existingKindleBooks = await _context.KindleBooks
                .Include(kb => kb.Book)
                .Where(kb => kb.KindleAccountId == account.Id)
                .ToListAsync();

            foreach (var kindleBook in kindleBooks)
            {
                try
                {
                    // Truncate ASIN to fit database limit (50 characters)
                    var asin = kindleBook.Asin?.Length > 50 ? kindleBook.Asin.Substring(0, 50) : kindleBook.Asin;
                    
                    if (string.IsNullOrEmpty(asin))
                    {
                        _logger.LogWarning("Skipping book with empty ASIN: {Title}", kindleBook.Title);
                        continue;
                    }

                    // Check if document already exists
                    var existingKindleBook = existingKindleBooks
                        .FirstOrDefault(kb => kb.Asin == asin);

                    if (existingKindleBook != null)
                    {
                        // Update existing book
                        if (kindleBook.Position > 0)
                        {
                            existingKindleBook.LastKindlePosition = kindleBook.Position;
                            existingKindleBook.LastKindlePositionUpdatedAt = DateTime.UtcNow;
                            result.ProgressSynced++;
                        }
                        existingKindleBook.UpdatedAt = DateTime.UtcNow;
                        result.BooksUpdated++;
                        
                        _logger.LogDebug("Book already exists, updating: {Title} (ASIN: {Asin})", kindleBook.Title, asin);
                    }
                    else
                    {
                        // For MVP: Create book entry without downloading file (DRM download not implemented yet)
                        // TODO: Implement DownloadKindleDocumentAsync for personal documents
                        
                        // Truncate title and author to fit database column limits
                        var title = kindleBook.Title?.Length > 500 ? kindleBook.Title.Substring(0, 497) + "..." : kindleBook.Title;
                        var author = kindleBook.Author?.Length > 200 ? kindleBook.Author.Substring(0, 197) + "..." : kindleBook.Author;
                        
                        // Create book entity without file
                        var newBook = new Book
                        {
                            Id = Guid.NewGuid(),
                            UserId = userId,
                            Title = title ?? "Unknown Title",
                            Author = author ?? "Unknown Author",
                            FilePath = null, // No file yet - download not implemented
                            CoverImagePath = null,
                            UploadedAt = DateTime.UtcNow
                        };

                        _context.Books.Add(newBook);

                        var newKindleBook = new KindleBook
                        {
                            Id = Guid.NewGuid(),
                            BookId = newBook.Id,
                            KindleAccountId = account.Id,
                            Asin = asin,
                            LastKindlePosition = kindleBook.Position,
                            LastKindlePositionUpdatedAt = kindleBook.Position > 0 ? DateTime.UtcNow : null,
                            CreatedAt = DateTime.UtcNow,
                            UpdatedAt = DateTime.UtcNow
                        };

                        _context.KindleBooks.Add(newKindleBook);
                        existingKindleBooks.Add(newKindleBook); // Add to list to prevent duplicates in same sync
                        result.BooksAdded++;
                        
                        _logger.LogInformation("Added Kindle book metadata (file not downloaded): {Title} (ASIN: {Asin})", kindleBook.Title, asin);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error syncing Kindle book {Asin} - {Title}", kindleBook.Asin, kindleBook.Title);
                    result.Errors.Add($"Error syncing {kindleBook.Title}: {ex.Message}");
                }
            }

            account.LastSyncedAt = DateTime.UtcNow;
            // Truncate error message to fit in column (1000 chars max)
            var errorMessage = result.Errors.Any() ? string.Join("; ", result.Errors) : null;
            account.LastSyncError = errorMessage?.Length > 1000 ? errorMessage.Substring(0, 997) + "..." : errorMessage;
            await _context.SaveChangesAsync();

            result.Success = true;
            _logger.LogInformation("Synced Kindle library for user {UserId}: {Added} added, {Updated} updated",
                userId, result.BooksAdded, result.BooksUpdated);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error syncing Kindle library for user {UserId}", userId);
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    public async Task<bool> SyncReadingProgressAsync(Guid userId, Guid bookId)
    {
        try
        {
            var kindleBook = await _context.KindleBooks
                .Include(kb => kb.KindleAccount)
                .FirstOrDefaultAsync(kb => kb.BookId == bookId && kb.KindleAccount.UserId == userId);

            if (kindleBook == null)
                return false;

            var sessionCookies = DecryptCredentials(kindleBook.KindleAccount.EncryptedCredentials);
            var position = await FetchBookPositionAsync(sessionCookies, kindleBook.Asin, kindleBook.KindleAccount.Marketplace);

            if (position >= 0)
            {
                kindleBook.LastKindlePosition = position;
                kindleBook.LastKindlePositionUpdatedAt = DateTime.UtcNow;
                await _context.SaveChangesAsync();
                return true;
            }

            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error syncing reading progress for book {BookId}", bookId);
            return false;
        }
    }

    public async Task<bool> PushProgressToKindleAsync(Guid userId, Guid bookId, int position)
    {
        try
        {
            var kindleBook = await _context.KindleBooks
                .Include(kb => kb.KindleAccount)
                .FirstOrDefaultAsync(kb => kb.BookId == bookId && kb.KindleAccount.UserId == userId);

            if (kindleBook == null)
                return false;

            var sessionCookies = DecryptCredentials(kindleBook.KindleAccount.EncryptedCredentials);
            var success = await UpdateKindlePositionAsync(sessionCookies, kindleBook.Asin, position, kindleBook.KindleAccount.Marketplace);

            if (success)
            {
                kindleBook.LastKindlePosition = position;
                kindleBook.LastKindlePositionUpdatedAt = DateTime.UtcNow;
                await _context.SaveChangesAsync();
            }

            return success;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error pushing reading progress to Kindle for book {BookId}", bookId);
            return false;
        }
    }

    #region Private Helper Methods

    private async Task<string> AuthenticateWithAmazonAsync(string email, string password, string marketplace)
    {
        try
        {
            var baseUrl = $"https://www.amazon.{marketplace}";
            var cookieContainer = new CookieContainer();
            var handler = new HttpClientHandler { CookieContainer = cookieContainer };
            using var client = new HttpClient(handler);

            // Step 1: Get sign-in page to retrieve necessary tokens
            var signInUrl = $"{baseUrl}/ap/signin";
            var response = await client.GetAsync(signInUrl);
            var content = await response.Content.ReadAsStringAsync();

            // Extract CSRF token and other required fields
            var csrfToken = ExtractValue(content, "name=\"metadata1\" value=\"([^\"]+)\"");
            var appActionToken = ExtractValue(content, "name=\"appActionToken\" value=\"([^\"]+)\"");

            // Step 2: Submit login credentials
            var loginData = new Dictionary<string, string>
            {
                { "email", email },
                { "password", password },
                { "metadata1", csrfToken },
                { "appActionToken", appActionToken },
                { "create", "0" }
            };

            var loginResponse = await client.PostAsync(signInUrl, new FormUrlEncodedContent(loginData));
            
            if (!loginResponse.IsSuccessStatusCode)
            {
                _logger.LogWarning("Login failed with status {StatusCode}", loginResponse.StatusCode);
                return string.Empty;
            }

            // Extract session cookies
            var cookies = cookieContainer.GetCookies(new Uri(baseUrl));
            var sessionCookies = new Dictionary<string, string>();
            
            foreach (Cookie cookie in cookies)
            {
                sessionCookies[cookie.Name] = cookie.Value;
            }

            return JsonSerializer.Serialize(sessionCookies);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error authenticating with Amazon");
            return string.Empty;
        }
    }

    private async Task<List<KindleBookInfo>> FetchKindleLibraryAsync(string sessionCookies, string marketplace)
    {
        var books = new List<KindleBookInfo>();
        
        try
        {
            var baseUrl = $"https://www.amazon.{marketplace}";
            var cookies = ParseCookies(sessionCookies);
            
            var handler = new HttpClientHandler();
            var cookieContainer = new CookieContainer();
            
            if (cookies != null)
            {
                foreach (var cookie in cookies)
                {
                    try
                    {
                        cookieContainer.Add(new Uri(baseUrl), new Cookie(cookie.Key, cookie.Value));
                    }
                    catch { /* Skip invalid cookies */ }
                }
            }
            
            handler.CookieContainer = cookieContainer;
            handler.AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate;
            using var client = new HttpClient(handler);
            client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
            client.DefaultRequestHeaders.Add("Accept", "application/json, text/javascript, */*; q=0.01");
            client.DefaultRequestHeaders.Add("Accept-Language", "es-ES,es;q=0.9,en;q=0.8");
            client.DefaultRequestHeaders.Add("X-Requested-With", "XMLHttpRequest");

            // First, get the page to extract CSRF token
            var pageUrl = $"{baseUrl}/hz/mycd/digital-console/contentlist/pdocs/dateDsc/";
            var pageResponse = await client.GetAsync(pageUrl);
            var pageContent = await pageResponse.Content.ReadAsStringAsync();
            
            // Extract CSRF token from page
            var csrfMatch = Regex.Match(pageContent, @"csrfToken[""']?\s*[:=]\s*[""']([^""']+)[""']");
            var csrfToken = csrfMatch.Success ? csrfMatch.Groups[1].Value : "";
            
            if (string.IsNullOrEmpty(csrfToken))
            {
                _logger.LogWarning("Could not extract CSRF token from page");
                return books;
            }
            
            _logger.LogInformation("Extracted CSRF token: {Token}", csrfToken.Substring(0, Math.Min(20, csrfToken.Length)) + "...");

            // Call the AJAX API endpoint to get actual document data
            var ajaxUrl = $"{baseUrl}/hz/mycd/digital-console/ajax";
            var activityInput = new
            {
                contentType = "KindlePDoc",
                contentCategoryReference = "pdocs",
                itemStatusList = new[] { "Active" },
                fetchCriteria = new
                {
                    sortOrder = "DESCENDING",
                    sortIndex = "DATE",
                    startIndex = 0,
                    batchSize = 100,
                    totalContentCount = -1
                },
                surfaceType = "Desktop"
            };
            
            var formData = new Dictionary<string, string>
            {
                { "activity", "GetContentOwnershipData" },
                { "activityInput", JsonSerializer.Serialize(activityInput) },
                { "clientId", "MYCD_WebService" },
                { "csrfToken", csrfToken }
            };
            
            _logger.LogInformation("Calling AJAX endpoint: {Url}", ajaxUrl);
            
            // Add Referer and Origin headers for AJAX request (Amazon requires this)
            var ajaxRequest = new HttpRequestMessage(HttpMethod.Post, ajaxUrl);
            ajaxRequest.Headers.Add("Referer", pageUrl);
            ajaxRequest.Headers.Add("Origin", baseUrl);
            ajaxRequest.Content = new FormUrlEncodedContent(formData);
            
            _logger.LogInformation("AJAX Request Headers: User-Agent={UA}, Accept={Accept}, Referer={Referer}, Origin={Origin}", 
                client.DefaultRequestHeaders.UserAgent.ToString(),
                client.DefaultRequestHeaders.Accept.ToString(),
                pageUrl,
                baseUrl);
            
            var response = await client.SendAsync(ajaxRequest);
            var content = await response.Content.ReadAsStringAsync();
            
            _logger.LogInformation("Response status: {Status}, Content length: {Length}, Content-Type: {ContentType}", 
                response.StatusCode, content.Length, response.Content.Headers.ContentType?.ToString() ?? "none");
            
            // If we got HTML instead of JSON, save first 2000 chars for inspection
            if (content.TrimStart().StartsWith("<"))
            {
                var htmlSnippet = content.Length > 2000 ? content.Substring(0, 2000) : content;
                _logger.LogWarning("AJAX endpoint returned HTML instead of JSON. First 2000 chars: {Html}", htmlSnippet);
            }

            // Parse JSON response
            try
            {
                using var jsonDoc = JsonDocument.Parse(content);
                var root = jsonDoc.RootElement;
                
                // Check if the response was successful
                if (root.TryGetProperty("success", out var successProp) && !successProp.GetBoolean())
                {
                    _logger.LogWarning("API returned success=false");
                    return books;
                }
                
                // Navigate to the items array
                if (root.TryGetProperty("GetContentOwnershipData", out var dataObj) &&
                    dataObj.TryGetProperty("items", out var itemsArray))
                {
                    foreach (var item in itemsArray.EnumerateArray())
                    {
                        try
                        {
                            var asin = item.TryGetProperty("asin", out var asinProp) ? asinProp.GetString() : null;
                            var title = item.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : null;
                            var author = item.TryGetProperty("author", out var authorProp) ? authorProp.GetString() : "Unknown";
                            
                            if (string.IsNullOrEmpty(asin) || string.IsNullOrEmpty(title))
                                continue;
                            
                            // Skip if we already have this document
                            if (books.Any(b => b.Asin == asin))
                                continue;

                            books.Add(new KindleBookInfo
                            {
                                Asin = asin,
                                Title = title,
                                Author = author,
                                Position = 0,
                                IsPersonalDocument = true
                            });
                            
                            _logger.LogInformation("Found document: {Title} by {Author} (ASIN: {Asin})", title, author, asin);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Error parsing document item");
                        }
                    }
                }
                else
                {
                    _logger.LogWarning("Could not find items array in response");
                    // Log a snippet of the response for debugging
                    var snippet = content.Length > 500 ? content.Substring(0, 500) : content;
                    _logger.LogInformation("Response snippet: {Snippet}", snippet);
                }
            }
            catch (JsonException ex)
            {
                _logger.LogError(ex, "Failed to parse JSON response");
                var snippet = content.Length > 500 ? content.Substring(0, 500) : content;
                _logger.LogInformation("Response snippet: {Snippet}", snippet);
            }
            
            _logger.LogInformation("Total documents found: {Count}", books.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching Kindle documents");
        }

        return books;
    }

    private async Task<BookFileInfo?> DownloadKindleDocumentAsync(string sessionCookies, string asin, string marketplace)
    {
        try
        {
            var baseUrl = $"https://www.amazon.{marketplace}";
            var cookies = ParseCookies(sessionCookies);
            
            var handler = new HttpClientHandler();
            var cookieContainer = new CookieContainer();
            
            if (cookies != null)
            {
                foreach (var cookie in cookies)
                {
                    try
                    {
                        cookieContainer.Add(new Uri(baseUrl), new Cookie(cookie.Key, cookie.Value));
                    }
                    catch { /* Skip invalid cookies */ }
                }
            }
            
            handler.CookieContainer = cookieContainer;
            using var client = new HttpClient(handler);
            client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

            // Download personal document - these are not DRM protected!
            // Amazon allows downloading personal docs via "Download & transfer via USB"
            var downloadUrl = $"{baseUrl}/hz/mycd/download?asin={asin}&isPersonalDoc=true";
            _logger.LogInformation("Attempting to download document: {Asin}", asin);
            
            var response = await client.GetAsync(downloadUrl);
            
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Download failed with status {Status} for ASIN {Asin}", 
                    response.StatusCode, asin);
                return null;
            }

            var contentType = response.Content.Headers.ContentType?.MediaType ?? "";
            var fileName = $"{asin}";
            
            // Determine file extension from content type or disposition
            var contentDisposition = response.Content.Headers.ContentDisposition?.FileName?.Trim('"');
            if (!string.IsNullOrEmpty(contentDisposition))
            {
                fileName = contentDisposition;
            }
            else if (contentType.Contains("epub"))
            {
                fileName += ".epub";
            }
            else if (contentType.Contains("mobi") || contentType.Contains("x-mobipocket"))
            {
                fileName += ".mobi";
            }
            else if (contentType.Contains("pdf"))
            {
                fileName += ".pdf";
            }
            else
            {
                fileName += ".azw3"; // Default Kindle format
            }

            // Save the file
            var storagePath = Path.Combine("storage", "books", fileName);
            var fullPath = Path.Combine(Directory.GetCurrentDirectory(), storagePath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

            var fileBytes = await response.Content.ReadAsByteArrayAsync();
            await File.WriteAllBytesAsync(fullPath, fileBytes);

            _logger.LogInformation("Downloaded document to: {Path} ({Size} bytes)", 
                storagePath, fileBytes.Length);

            return new BookFileInfo
            {
                Path = storagePath,
                CoverPath = null // Could extract cover from the file later
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error downloading Kindle document {Asin}", asin);
            return null;
        }
    }

    private async Task<int> FetchBookPositionAsync(string sessionCookies, string asin, string marketplace)
    {
        try
        {
            var baseUrl = $"https://read.amazon.{marketplace}";
            var cookies = JsonSerializer.Deserialize<Dictionary<string, string>>(sessionCookies);
            
            var handler = new HttpClientHandler();
            var cookieContainer = new CookieContainer();
            
            if (cookies != null)
            {
                foreach (var cookie in cookies)
                {
                    cookieContainer.Add(new Uri(baseUrl), new Cookie(cookie.Key, cookie.Value));
                }
            }
            
            handler.CookieContainer = cookieContainer;
            using var client = new HttpClient(handler);

            // Fetch reading position (simplified - actual API endpoint may vary)
            var positionUrl = $"{baseUrl}/api/reader/positions?asin={asin}";
            var response = await client.GetAsync(positionUrl);
            
            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                var positionData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(content);
                
                if (positionData != null && positionData.ContainsKey("position"))
                {
                    return positionData["position"].GetInt32();
                }
            }

            return 0;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching book position for ASIN {Asin}", asin);
            return -1;
        }
    }

    private async Task<bool> UpdateKindlePositionAsync(string sessionCookies, string asin, int position, string marketplace)
    {
        try
        {
            var baseUrl = $"https://read.amazon.{marketplace}";
            var cookies = JsonSerializer.Deserialize<Dictionary<string, string>>(sessionCookies);
            
            var handler = new HttpClientHandler();
            var cookieContainer = new CookieContainer();
            
            if (cookies != null)
            {
                foreach (var cookie in cookies)
                {
                    cookieContainer.Add(new Uri(baseUrl), new Cookie(cookie.Key, cookie.Value));
                }
            }
            
            handler.CookieContainer = cookieContainer;
            using var client = new HttpClient(handler);

            // Update reading position
            var updateData = new { asin, position };
            var response = await client.PostAsJsonAsync($"{baseUrl}/api/reader/positions", updateData);
            
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating Kindle position for ASIN {Asin}", asin);
            return false;
        }
    }

    private string EncryptCredentials(string credentials)
    {
        using var aes = Aes.Create();
        aes.Key = Encoding.UTF8.GetBytes(_encryptionKey.PadRight(32).Substring(0, 32));
        aes.GenerateIV();

        using var encryptor = aes.CreateEncryptor();
        var credentialsBytes = Encoding.UTF8.GetBytes(credentials);
        var encrypted = encryptor.TransformFinalBlock(credentialsBytes, 0, credentialsBytes.Length);

        var result = new byte[aes.IV.Length + encrypted.Length];
        Buffer.BlockCopy(aes.IV, 0, result, 0, aes.IV.Length);
        Buffer.BlockCopy(encrypted, 0, result, aes.IV.Length, encrypted.Length);

        return Convert.ToBase64String(result);
    }

    private string DecryptCredentials(string encryptedCredentials)
    {
        var fullCipher = Convert.FromBase64String(encryptedCredentials);

        using var aes = Aes.Create();
        aes.Key = Encoding.UTF8.GetBytes(_encryptionKey.PadRight(32).Substring(0, 32));

        var iv = new byte[aes.IV.Length];
        var cipher = new byte[fullCipher.Length - iv.Length];

        Buffer.BlockCopy(fullCipher, 0, iv, 0, iv.Length);
        Buffer.BlockCopy(fullCipher, iv.Length, cipher, 0, cipher.Length);

        aes.IV = iv;

        using var decryptor = aes.CreateDecryptor();
        var decrypted = decryptor.TransformFinalBlock(cipher, 0, cipher.Length);

        return Encoding.UTF8.GetString(decrypted);
    }

    private static string ExtractValue(string content, string pattern)
    {
        var match = Regex.Match(content, pattern);
        return match.Success ? match.Groups[1].Value : string.Empty;
    }

    #endregion
}

internal class KindleBookInfo
{
    public string Asin { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public int Position { get; set; }
    public bool IsPersonalDocument { get; set; } = false;
}

internal class BookFileInfo
{
    public string Path { get; set; } = string.Empty;
    public string? CoverPath { get; set; }
}

// DTO for parsing JSON cookie arrays from browser extensions
internal class CookieDto
{
    public string Name { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Domain { get; set; }
    public string? Path { get; set; }
    public bool? Secure { get; set; }
    public bool? HttpOnly { get; set; }
}
