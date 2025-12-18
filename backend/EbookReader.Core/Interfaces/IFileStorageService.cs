namespace EbookReader.Core.Interfaces
{
    /// <summary>
    /// Abstraction for file storage that works with both Azure Blob Storage and local filesystem
    /// </summary>
    public interface IFileStorageService
    {
        /// <summary>
        /// Upload a file to storage
        /// </summary>
        /// <param name="fileName">Name of the file</param>
        /// <param name="stream">File content stream</param>
        /// <param name="contentType">MIME type of the file</param>
        /// <returns>URI/path to the stored file</returns>
        Task<string> UploadFileAsync(string fileName, Stream stream, string contentType);

        /// <summary>
        /// Download a file from storage
        /// </summary>
        /// <param name="filePath">URI/path to the file</param>
        /// <returns>File content stream</returns>
        Task<Stream> DownloadFileAsync(string filePath);

        /// <summary>
        /// Delete a file from storage
        /// </summary>
        /// <param name="filePath">URI/path to the file</param>
        Task DeleteFileAsync(string filePath);

        /// <summary>
        /// Check if a file exists
        /// </summary>
        /// <param name="filePath">URI/path to the file</param>
        /// <returns>True if file exists</returns>
        Task<bool> FileExistsAsync(string filePath);

        /// <summary>
        /// Get file size in bytes
        /// </summary>
        /// <param name="filePath">URI/path to the file</param>
        /// <returns>File size in bytes</returns>
        Task<long> GetFileSizeAsync(string filePath);
    }
}
