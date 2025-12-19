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

        public async Task<string> UploadFileAsync(string fileName, Stream stream)
        {
            var filePath = Path.Combine(_storagePath, fileName);
            var directory = Path.GetDirectoryName(filePath);
            
            if (directory != null && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            using var fileStream = new FileStream(filePath, FileMode.Create, FileAccess.Write);
            await stream.CopyToAsync(fileStream);

            return fileName;
        }

        public async Task<Stream> DownloadFileAsync(string filePath)
        {
            var fullPath = Path.Combine(_storagePath, filePath);
            if (!File.Exists(fullPath))
            {
                throw new FileNotFoundException($"File not found: {filePath}");
            }

            var memoryStream = new MemoryStream();
            using var fileStream = new FileStream(fullPath, FileMode.Open, FileAccess.Read);
            await fileStream.CopyToAsync(memoryStream);
            memoryStream.Position = 0;
            
            return memoryStream;
        }

        public Task DeleteFileAsync(string filePath)
        {
            var fullPath = Path.Combine(_storagePath, filePath);
            if (File.Exists(fullPath))
            {
                File.Delete(fullPath);
            }
            
            return Task.CompletedTask;
        }

        public Task<bool> FileExistsAsync(string filePath)
        {
            var fullPath = Path.Combine(_storagePath, filePath);
            return Task.FromResult(File.Exists(fullPath));
        }

        public Task<long> GetFileSizeAsync(string filePath)
        {
            var fullPath = Path.Combine(_storagePath, filePath);
            if (!File.Exists(fullPath))
            {
                throw new FileNotFoundException($"File not found: {filePath}");
            }

            var fileInfo = new FileInfo(fullPath);
            return Task.FromResult(fileInfo.Length);
        }

        public string GetFilePath(string filePath)
        {
            return Path.Combine(_storagePath, filePath);
        }
    }
}
