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
    public class BooksController : ControllerBase
    {
        private readonly EbookReaderDbContext _context;

        public BooksController(EbookReaderDbContext context)
        {
            _context = context;
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
        public async Task<ActionResult<Book>> CreateBook(Book book)
        {
            var userId = GetCurrentUserId();
            book.Id = Guid.NewGuid();
            book.UserId = userId;
            book.UploadedAt = DateTime.UtcNow;
            
            _context.Books.Add(book);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetBook), new { id = book.Id }, book);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteBook(Guid id)
        {
            var userId = GetCurrentUserId();
            var book = await _context.Books
                .FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId);
            
            if (book == null)
            {
                return NotFound();
            }

            _context.Books.Remove(book);
            await _context.SaveChangesAsync();

            return NoContent();
        }
    }
}
