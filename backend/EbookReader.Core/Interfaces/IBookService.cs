using EbookReader.Core.Entities;

namespace EbookReader.Core.Interfaces
{
    public interface IBookService
    {
        /// <summary>
        /// Parses an EPUB file and extracts book metadata and chapters
        /// </summary>
        /// <param name="filePath">Path to the EPUB file</param>
        /// <param name="userId">ID of the user uploading the book</param>
        /// <returns>A populated Book entity with chapters</returns>
        Task<Book> ParseEpubAsync(string filePath, Guid userId);
        
        /// <summary>
        /// Extracts and saves the cover image from an EPUB file
        /// </summary>
        /// <param name="filePath">Path to the EPUB file</param>
        /// <param name="userId">ID of the user</param>
        /// <param name="bookId">ID of the book</param>
        /// <returns>Path to the saved cover image or null if no cover found</returns>
        Task<string?> ExtractCoverImageAsync(string filePath, Guid userId, Guid bookId);
        
        /// <summary>
        /// Validates if a file is a valid EPUB file
        /// </summary>
        bool IsValidEpub(Stream fileStream);
    }
}
