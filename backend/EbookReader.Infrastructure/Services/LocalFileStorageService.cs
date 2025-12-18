using EbookReader.Core.Interfaces;
using Microsoft.Extensions.Configuration;

namespace EbookReader.Infrastructure.Services
{
    /// <summary>
    /// Local filesystem implementation of file storage
    /// Used for self-hosted deployments or local development
    /// </summary>
    public class LocalFileStorageService : IFileStorageService
    {
        private readonly string _storagePath;

        public LocalFileStorageService(IConfiguration configuration)
        {
            _storagePath = configuration["FileStorage:LocalPath"] ?? Path.Combine(Directory.GetCurrentDirectory(), "storage");
            
            // Ensure storage directory exists
            if (!Directory.Exists(_storagePath))
            {
                Directory.CreateDirectory(_storagePath);
            }
        }

        public async Task<string> UploadFileAsync(string fileName, Stream stream, string contentType)
        {
            var filePath = Path.Combine(_storagePath, fileName);
            var directory = Path.GetDirectoryName(filePath);
            
            if (directory != null && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            using var fileStream = new FileStream(filePath, FileMode.Create, FileAccess.Write);
            await stream.CopyToAsync(fileStream);

            return filePath;
        }

        public async Task<Stream> DownloadFileAsync(string filePath)
        {
            if (!File.Exists(filePath))
            {
                throw new FileNotFoundException($"File not found: {filePath}");
            }

            var memoryStream = new MemoryStream();
            using var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
            await fileStream.CopyToAsync(memoryStream);
            memoryStream.Position = 0;
            
            return memoryStream;
        }

        public Task DeleteFileAsync(string filePath)
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
            
            return Task.CompletedTask;
        }

        public Task<bool> FileExistsAsync(string filePath)
        {
            return Task.FromResult(File.Exists(filePath));
        }

        public Task<long> GetFileSizeAsync(string filePath)
        {
            if (!File.Exists(filePath))
            {
                throw new FileNotFoundException($"File not found: {filePath}");
            }

            var fileInfo = new FileInfo(filePath);
            return Task.FromResult(fileInfo.Length);
        }
    }
}
