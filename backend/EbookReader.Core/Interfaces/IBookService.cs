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
        /// Validates if a file is a valid EPUB file
        /// </summary>
        bool IsValidEpub(Stream fileStream);
    }
}
