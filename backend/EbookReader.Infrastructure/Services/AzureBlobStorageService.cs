using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using EbookReader.Core.Interfaces;
using Microsoft.Extensions.Configuration;

namespace EbookReader.Infrastructure.Services
{
    /// <summary>
    /// Azure Blob Storage implementation of file storage
    /// Used for Azure deployments with scalable cloud storage
    /// </summary>
    public class AzureBlobStorageService : IFileStorageService
    {
        private readonly BlobContainerClient _containerClient;
        private readonly string _containerName;

        public AzureBlobStorageService(IConfiguration configuration)
        {
            var connectionString = configuration["FileStorage:AzureBlobConnectionString"];
            _containerName = configuration["FileStorage:ContainerName"] ?? "ebooks";

            if (string.IsNullOrEmpty(connectionString))
            {
                throw new InvalidOperationException("Azure Blob Storage connection string is not configured");
            }

            var blobServiceClient = new BlobServiceClient(connectionString);
            _containerClient = blobServiceClient.GetBlobContainerClient(_containerName);
            
            // Ensure container exists
            _containerClient.CreateIfNotExists();
        }

        public async Task<string> UploadFileAsync(string fileName, Stream stream)
        {
            var blobClient = _containerClient.GetBlobClient(fileName);
            
            await blobClient.UploadAsync(stream);
            
            return fileName;
        }

        public async Task<Stream> DownloadFileAsync(string filePath)
        {
            // Extract blob name from full URL if needed
            var blobName = GetBlobNameFromPath(filePath);
            var blobClient = _containerClient.GetBlobClient(blobName);

            if (!await blobClient.ExistsAsync())
            {
                throw new FileNotFoundException($"Blob not found: {blobName}");
            }

            var memoryStream = new MemoryStream();
            await blobClient.DownloadToAsync(memoryStream);
            memoryStream.Position = 0;
            
            return memoryStream;
        }

        public async Task DeleteFileAsync(string filePath)
        {
            var blobName = GetBlobNameFromPath(filePath);
            var blobClient = _containerClient.GetBlobClient(blobName);
            
            await blobClient.DeleteIfExistsAsync();
        }

        public async Task<bool> FileExistsAsync(string filePath)
        {
            var blobName = GetBlobNameFromPath(filePath);
            var blobClient = _containerClient.GetBlobClient(blobName);
            
            return await blobClient.ExistsAsync();
        }

        public async Task<long> GetFileSizeAsync(string filePath)
        {
            var blobName = GetBlobNameFromPath(filePath);
            var blobClient = _containerClient.GetBlobClient(blobName);

            if (!await blobClient.ExistsAsync())
            {
                throw new FileNotFoundException($"Blob not found: {blobName}");
            }

            var properties = await blobClient.GetPropertiesAsync();
            return properties.Value.ContentLength;
        }

        private string GetBlobNameFromPath(string filePath)
        {
            // If it's a full URL, extract the blob name
            if (Uri.TryCreate(filePath, UriKind.Absolute, out var uri))
            {
                return uri.Segments.Last();
            }
            
            // Otherwise, it's already a blob name
            return filePath;
        }

        public string GetFilePath(string filePath)
        {
            // For Azure Blob, we need to download to a temp file for parsing
            var blobName = GetBlobNameFromPath(filePath);
            var tempPath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}{Path.GetExtension(blobName)}");
            
            // Download blob to temp file synchronously (not ideal but needed for EPUB parsing)
            var blobClient = _containerClient.GetBlobClient(blobName);
            blobClient.DownloadTo(tempPath);
            
            return tempPath;
        }
    }
}
