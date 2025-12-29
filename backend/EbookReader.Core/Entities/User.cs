namespace EbookReader.Core.Entities
{
    public class User
    {
        public Guid Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string PasswordHash { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public DateTime? LastLoginAt { get; set; }

        // User preferences
        public string PreferredTtsProvider { get; set; } = "elevenlabs"; // elevenlabs | azure
        public string? PreferredAzureVoiceName { get; set; }
        public bool EnableSsmlEnhancement { get; set; } = false;

        // Navigation properties
        public ICollection<Book> Books { get; set; } = new List<Book>();
        public ICollection<ReadingProgress> ReadingProgresses { get; set; } = new List<ReadingProgress>();
    }
}
