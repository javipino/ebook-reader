using EbookReader.Core.Entities;
using EbookReader.Core.Interfaces;
using Microsoft.Extensions.Logging;
using System.Text;
using System.Text.RegularExpressions;
using VersOne.Epub;

namespace EbookReader.Infrastructure.Services
{
    public class BookService : IBookService
    {
        private readonly ILogger<BookService> _logger;
        private readonly IFileStorageService _fileStorageService;

        public BookService(ILogger<BookService> logger, IFileStorageService fileStorageService)
        {
            _logger = logger;
            _fileStorageService = fileStorageService;
        }

        public async Task<Book> ParseEpubAsync(string filePath, Guid userId)
        {
            _logger.LogInformation("Starting EPUB parsing for file: {FilePath}", filePath);

            try
            {
                // Open the EPUB file
                var epubBook = await EpubReader.ReadBookAsync(filePath);

                // Extract metadata
                var book = new Book
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    Title = epubBook.Title ?? "Unknown Title",
                    Author = epubBook.Author ?? "Unknown Author",
                    Description = epubBook.Description,
                    FilePath = filePath,
                    FileFormat = "EPUB",
                    UploadedAt = DateTime.UtcNow,
                    CharactersAnalyzed = false
                };

                _logger.LogInformation("Extracted metadata - Title: {Title}, Author: {Author}", book.Title, book.Author);

                // Parse chapters
                var chapters = new List<Chapter>();
                int chapterNumber = 1;

                // Get all HTML files from the reading order
                var readingOrder = epubBook.ReadingOrder;

                foreach (var localTextContentFile in readingOrder)
                {
                    try
                    {
                        // Read the HTML content
                        var content = localTextContentFile.Content;
                        if (string.IsNullOrWhiteSpace(content))
                        {
                            _logger.LogWarning("Skipping empty content for item");
                            continue;
                        }

                        // Clean HTML and extract text
                        var cleanContent = CleanHtmlContent(content);
                        
                        // Skip if content is too short (likely not a real chapter)
                        if (cleanContent.Length < 100)
                        {
                            _logger.LogDebug("Skipping short content (length: {Length})", cleanContent.Length);
                            continue;
                        }

                        // Use file name as chapter title or default
                        var title = $"Chapter {chapterNumber}";
                        
                        // Try to find title in navigation
                        var navItem = epubBook.Navigation?.FirstOrDefault(n => 
                            n.Link?.ContentFilePath == localTextContentFile.FilePath);
                        if (navItem != null && !string.IsNullOrEmpty(navItem.Title))
                        {
                            title = navItem.Title;
                        }

                        var chapter = new Chapter
                        {
                            Id = Guid.NewGuid(),
                            BookId = book.Id,
                            ChapterNumber = chapterNumber,
                            Title = title,
                            Content = cleanContent,
                            WordCount = CountWords(cleanContent),
                            AudioGenerated = false
                        };

                        chapters.Add(chapter);
                        _logger.LogDebug("Parsed chapter {Number}: {Title} ({WordCount} words)", 
                            chapterNumber, chapter.Title, chapter.WordCount);
                        
                        chapterNumber++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error parsing chapter {ChapterNumber}", chapterNumber);
                        // Continue with next chapter
                    }
                }

                book.Chapters = chapters;
                _logger.LogInformation("Successfully parsed {ChapterCount} chapters from EPUB", chapters.Count);

                return book;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to parse EPUB file: {FilePath}", filePath);
                throw new InvalidOperationException($"Failed to parse EPUB file: {ex.Message}", ex);
            }
        }

        public bool IsValidEpub(Stream fileStream)
        {
            try
            {
                // Reset stream position
                fileStream.Position = 0;

                // EPUB files are ZIP archives, check for ZIP signature
                var buffer = new byte[4];
                fileStream.Read(buffer, 0, 4);
                fileStream.Position = 0;

                // ZIP file signature: 50 4B 03 04 or 50 4B 05 06 or 50 4B 07 08
                return buffer[0] == 0x50 && buffer[1] == 0x4B && 
                       (buffer[2] == 0x03 || buffer[2] == 0x05 || buffer[2] == 0x07);
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Removes HTML tags and cleans content for text processing
        /// </summary>
        private string CleanHtmlContent(string html)
        {
            if (string.IsNullOrWhiteSpace(html))
                return string.Empty;

            // Remove script and style tags with their content
            html = Regex.Replace(html, @"<script[^>]*>[\s\S]*?</script>", "", RegexOptions.IgnoreCase);
            html = Regex.Replace(html, @"<style[^>]*>[\s\S]*?</style>", "", RegexOptions.IgnoreCase);

            // Replace <br>, <p> tags with newlines
            html = Regex.Replace(html, @"<br\s*/?>", "\n", RegexOptions.IgnoreCase);
            html = Regex.Replace(html, @"</p>", "\n\n", RegexOptions.IgnoreCase);

            // Remove all remaining HTML tags
            html = Regex.Replace(html, @"<[^>]+>", "");

            // Decode HTML entities
            html = System.Net.WebUtility.HtmlDecode(html);

            // Clean up whitespace
            html = Regex.Replace(html, @"[ \t]+", " "); // Multiple spaces to single space
            html = Regex.Replace(html, @"\n[ \t]+", "\n"); // Remove spaces at start of lines
            html = Regex.Replace(html, @"[ \t]+\n", "\n"); // Remove spaces at end of lines
            html = Regex.Replace(html, @"\n{3,}", "\n\n"); // Multiple newlines to double newline

            return html.Trim();
        }

        /// <summary>
        /// Counts words in text content
        /// </summary>
        private int CountWords(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
                return 0;

            var words = text.Split(new[] { ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            return words.Length;
        }

        public async Task<string?> ExtractCoverImageAsync(string filePath, Guid userId, Guid bookId)
        {
            try
            {
                _logger.LogInformation("Extracting cover image from EPUB: {FilePath}", filePath);
                
                var epubBook = await EpubReader.ReadBookAsync(filePath);
                
                // Try to get cover image from metadata
                byte[]? coverImageBytes = epubBook.CoverImage;
                
                if (coverImageBytes == null || coverImageBytes.Length == 0)
                {
                    _logger.LogWarning("No cover image found in EPUB file");
                    return null;
                }

                // Determine file extension from image data
                string extension = GetImageExtension(coverImageBytes);
                string fileName = $"cover{extension}";
                string coverPath = Path.Combine("covers", userId.ToString(), bookId.ToString(), fileName);

                // Save cover image to storage
                using (var stream = new MemoryStream(coverImageBytes))
                {
                    await _fileStorageService.UploadFileAsync(coverPath, stream);
                }

                _logger.LogInformation("Cover image saved to: {CoverPath}", coverPath);
                return coverPath;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to extract cover image from EPUB");
                return null;
            }
        }

        private string GetImageExtension(byte[] imageBytes)
        {
            // Check PNG signature
            if (imageBytes.Length >= 8 && 
                imageBytes[0] == 0x89 && imageBytes[1] == 0x50 && 
                imageBytes[2] == 0x4E && imageBytes[3] == 0x47)
                return ".png";

            // Check JPEG signature
            if (imageBytes.Length >= 2 && 
                imageBytes[0] == 0xFF && imageBytes[1] == 0xD8)
                return ".jpg";

            // Check GIF signature
            if (imageBytes.Length >= 6 && 
                imageBytes[0] == 0x47 && imageBytes[1] == 0x49 && imageBytes[2] == 0x46)
                return ".gif";

            // Check WebP signature
            if (imageBytes.Length >= 12 && 
                imageBytes[0] == 0x52 && imageBytes[1] == 0x49 && 
                imageBytes[2] == 0x46 && imageBytes[3] == 0x46)
                return ".webp";

            // Default to jpg
            return ".jpg";
        }
    }
}
