using EbookReader.Core.Entities;
using EbookReader.Core.Interfaces;
using EbookReader.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace EbookReader.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class BooksController : ControllerBase
    {
        private readonly EbookReaderDbContext _context;
        private readonly IFileStorageService _fileStorageService;
        private readonly IBookService _bookService;
        private readonly ILogger<BooksController> _logger;
        private const long MaxFileSize = 50 * 1024 * 1024; // 50MB

        public BooksController(
            EbookReaderDbContext context,
            IFileStorageService fileStorageService,
            IBookService bookService,
            ILogger<BooksController> logger)
        {
            _context = context;
            _fileStorageService = fileStorageService;
            _bookService = bookService;
            _logger = logger;
        }

        private Guid GetCurrentUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value 
                           ?? User.FindFirst("sub")?.Value;
            return Guid.Parse(userIdClaim!);
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<object>>> GetBooks([FromQuery] int page = 1, [FromQuery] int pageSize = 20)
        {
            var userId = GetCurrentUserId();
            
            // Validate pagination parameters
            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 20;
            if (pageSize > 100) pageSize = 100; // Max 100 items per page
            
            var skip = (page - 1) * pageSize;
            
            var totalBooks = await _context.Books
                .Where(b => b.UserId == userId)
                .CountAsync();
            
            var books = await _context.Books
                .Where(b => b.UserId == userId)
                .OrderByDescending(b => b.UploadedAt)
                .Skip(skip)
                .Take(pageSize)
                .ToListAsync();
            
            // Return simplified book data with cover URL
            var result = books.Select(b => new
            {
                b.Id,
                b.Title,
                b.Author,
                b.Description,
                b.UploadedAt,
                b.CharactersAnalyzed,
                CoverImageUrl = !string.IsNullOrEmpty(b.CoverImagePath) 
                    ? $"/api/books/{b.Id}/cover" 
                    : null
            });
            
            // Add pagination headers
            Response.Headers.Append("X-Total-Count", totalBooks.ToString());
            Response.Headers.Append("X-Page", page.ToString());
            Response.Headers.Append("X-Page-Size", pageSize.ToString());
            Response.Headers.Append("X-Total-Pages", ((int)Math.Ceiling(totalBooks / (double)pageSize)).ToString());
            
            return Ok(result);
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<Book>> GetBook(Guid id)
        {
            var userId = GetCurrentUserId();
            var book = await _context.Books
                .Where(b => b.UserId == userId)
                .Include(b => b.Characters)
                .Include(b => b.Chapters)
                .FirstOrDefaultAsync(b => b.Id == id);

            if (book == null)
            {
                return NotFound();
            }

            return book;
        }

        [HttpPost]
        [RequestSizeLimit(MaxFileSize)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxFileSize)]
        public async Task<ActionResult<Book>> UploadBook(IFormFile file)
        {
            var userId = GetCurrentUserId();

            // Validate file exists
            if (file == null || file.Length == 0)
            {
                return BadRequest("No file uploaded");
            }

            // Validate file size
            if (file.Length > MaxFileSize)
            {
                return BadRequest($"File size exceeds maximum limit of {MaxFileSize / (1024 * 1024)}MB");
            }

            // Validate file extension
            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension != ".epub")
            {
                return BadRequest("Only EPUB files are supported");
            }

            // Validate EPUB file format
            using (var stream = file.OpenReadStream())
            {
                if (!_bookService.IsValidEpub(stream))
                {
                    return BadRequest("Invalid EPUB file format");
                }
            }

            try
            {
                _logger.LogInformation("User {UserId} uploading book: {FileName}", userId, file.FileName);

                // Generate unique filename
                var fileName = $"{Guid.NewGuid()}{extension}";
                var filePath = Path.Combine("books", userId.ToString(), fileName);

                // Save file to storage
                using (var stream = file.OpenReadStream())
                {
                    await _fileStorageService.UploadFileAsync(filePath, stream);
                }
                _logger.LogInformation("File saved to storage: {FilePath}", filePath);

                // Get local file path for parsing (if using local storage)
                // For Azure Blob, we'd need to download temp file
                var localFilePath = _fileStorageService.GetFilePath(filePath);

                // Parse EPUB and extract metadata + chapters
                var book = await _bookService.ParseEpubAsync(localFilePath, userId);
                book.FilePath = filePath; // Update with storage path

                // Extract and save cover image
                var coverPath = await _bookService.ExtractCoverImageAsync(localFilePath, userId, book.Id);
                if (coverPath != null)
                {
                    book.CoverImagePath = coverPath;
                }

                // Save to database
                _context.Books.Add(book);
                await _context.SaveChangesAsync();

                _logger.LogInformation("Book {BookId} successfully uploaded and parsed for user {UserId}", book.Id, userId);

                return CreatedAtAction(nameof(GetBook), new { id = book.Id }, book);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error uploading book for user {UserId}", userId);
                return StatusCode(500, "An error occurred while processing the book");
            }
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteBook(Guid id)
        {
            var userId = GetCurrentUserId();
            var book = await _context.Books
                .Include(b => b.Chapters)
                .FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId);
            
            if (book == null)
            {
                return NotFound();
            }

            try
            {
                // Delete the EPUB file from storage (if exists)
                if (!string.IsNullOrEmpty(book.FilePath))
                {
                    await _fileStorageService.DeleteFileAsync(book.FilePath);
                }

                // Delete cover image if exists
                if (!string.IsNullOrEmpty(book.CoverImagePath))
                {
                    await _fileStorageService.DeleteFileAsync(book.CoverImagePath);
                }

                // Delete audio files if any
                foreach (var chapter in book.Chapters.Where(c => !string.IsNullOrEmpty(c.AudioFilePath)))
                {
                    await _fileStorageService.DeleteFileAsync(chapter.AudioFilePath!);
                }

                // Also delete any linked KindleBooks
                var kindleBooks = await _context.KindleBooks.Where(kb => kb.BookId == id).ToListAsync();
                _context.KindleBooks.RemoveRange(kindleBooks);

                // Delete from database (cascades to chapters, characters, etc.)
                _context.Books.Remove(book);
                await _context.SaveChangesAsync();

                _logger.LogInformation("Book {BookId} deleted by user {UserId}", id, userId);
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting book {BookId}", id);
                return StatusCode(500, "An error occurred while deleting the book");
            }
        }

        [HttpPost("{id}/extract-cover")]
        public async Task<IActionResult> ExtractCover(Guid id)
        {
            var userId = GetCurrentUserId();
            var book = await _context.Books
                .FirstOrDefaultAsync(b => b.UserId == userId && b.Id == id);

            if (book == null)
            {
                return NotFound();
            }

            // Kindle books without file cannot have cover extracted
            if (string.IsNullOrEmpty(book.FilePath))
            {
                return NotFound("No file available for this book");
            }

            try
            {
                var localFilePath = _fileStorageService.GetFilePath(book.FilePath);
                var coverPath = await _bookService.ExtractCoverImageAsync(localFilePath, userId, book.Id);
                
                if (coverPath == null)
                {
                    return NotFound("No cover image found in EPUB file");
                }

                book.CoverImagePath = coverPath;
                await _context.SaveChangesAsync();

                _logger.LogInformation("Cover extracted for book {BookId}", id);
                return Ok(new { coverImageUrl = $"/api/books/{book.Id}/cover" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error extracting cover for book {BookId}", id);
                return StatusCode(500, "Failed to extract cover image");
            }
        }

        [HttpGet("{id}/cover")]
        public async Task<IActionResult> GetBookCover(Guid id)
        {
            var userId = GetCurrentUserId();
            var book = await _context.Books
                .Where(b => b.UserId == userId && b.Id == id)
                .FirstOrDefaultAsync();

            if (book == null)
            {
                return NotFound();
            }

            if (string.IsNullOrEmpty(book.CoverImagePath))
            {
                return NotFound("Book has no cover image");
            }

            try
            {
                var coverStream = await _fileStorageService.DownloadFileAsync(book.CoverImagePath);
                var extension = Path.GetExtension(book.CoverImagePath).ToLowerInvariant();
                
                var contentType = extension switch
                {
                    ".jpg" or ".jpeg" => "image/jpeg",
                    ".png" => "image/png",
                    ".gif" => "image/gif",
                    ".webp" => "image/webp",
                    _ => "application/octet-stream"
                };

                return File(coverStream, contentType);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving cover image for book {BookId}", id);
                return NotFound("Cover image not found");
            }
        }
    }
}
