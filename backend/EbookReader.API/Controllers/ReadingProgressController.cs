using EbookReader.Core.Entities;
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
    public class ReadingProgressController : ControllerBase
    {
        private readonly EbookReaderDbContext _context;
        private readonly ILogger<ReadingProgressController> _logger;

        public ReadingProgressController(
            EbookReaderDbContext context,
            ILogger<ReadingProgressController> logger)
        {
            _context = context;
            _logger = logger;
        }

        private Guid GetCurrentUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value 
                           ?? User.FindFirst("sub")?.Value;
            return Guid.Parse(userIdClaim!);
        }

        [HttpGet("{bookId}")]
        public async Task<ActionResult<ReadingProgress>> GetProgress(Guid bookId)
        {
            var userId = GetCurrentUserId();
            var progress = await _context.ReadingProgresses
                .FirstOrDefaultAsync(p => p.BookId == bookId && p.UserId == userId);

            if (progress == null)
            {
                // Return default progress for first page
                return Ok(new
                {
                    bookId,
                    userId,
                    currentChapterNumber = 1,
                    currentPosition = 0,
                    lastRead = DateTime.UtcNow,
                    isListening = false
                });
            }

            return Ok(progress);
        }

        [HttpPut("{bookId}")]
        public async Task<IActionResult> UpdateProgress(Guid bookId, [FromBody] UpdateProgressRequest request)
        {
            var userId = GetCurrentUserId();

            // Verify book exists and user has access
            var book = await _context.Books
                .FirstOrDefaultAsync(b => b.Id == bookId && b.UserId == userId);

            if (book == null)
            {
                return NotFound("Book not found");
            }

            var progress = await _context.ReadingProgresses
                .FirstOrDefaultAsync(p => p.BookId == bookId && p.UserId == userId);

            if (progress == null)
            {
                // Create new progress
                progress = new ReadingProgress
                {
                    Id = Guid.NewGuid(),
                    BookId = bookId,
                    UserId = userId,
                    CurrentChapterNumber = request.CurrentChapterNumber,
                    CurrentPosition = request.CurrentPosition,
                    LastRead = DateTime.UtcNow,
                    IsListening = request.IsListening
                };
                _context.ReadingProgresses.Add(progress);
            }
            else
            {
                // Update existing progress
                progress.CurrentChapterNumber = request.CurrentChapterNumber;
                progress.CurrentPosition = request.CurrentPosition;
                progress.LastRead = DateTime.UtcNow;
                progress.IsListening = request.IsListening;
            }

            await _context.SaveChangesAsync();

            _logger.LogInformation(
                "Updated reading progress for user {UserId}, book {BookId}: Chapter {Chapter}, Position {Position}",
                userId, bookId, request.CurrentChapterNumber, request.CurrentPosition);

            return Ok(progress);
        }
    }

    public class UpdateProgressRequest
    {
        public int CurrentChapterNumber { get; set; }
        public int CurrentPosition { get; set; }
        public bool IsListening { get; set; }
    }
}
