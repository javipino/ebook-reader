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
        public async Task<ActionResult<IEnumerable<Book>>> GetBooks()
        {
            var userId = GetCurrentUserId();
            return await _context.Books
                .Where(b => b.UserId == userId)
                .Include(b => b.Characters)
                .Include(b => b.Chapters)
                .ToListAsync();
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
                // Delete the EPUB file from storage
                await _fileStorageService.DeleteFileAsync(book.FilePath);

                // Delete audio files if any
                foreach (var chapter in book.Chapters.Where(c => !string.IsNullOrEmpty(c.AudioFilePath)))
                {
                    await _fileStorageService.DeleteFileAsync(chapter.AudioFilePath!);
                }

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
    }
}
