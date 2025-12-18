namespace EbookReader.Core.Entities
{
    public class Book
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Author { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string FilePath { get; set; } = string.Empty;
        public string FileFormat { get; set; } = string.Empty;
        public DateTime UploadedAt { get; set; }
        public bool CharactersAnalyzed { get; set; }
        
        public ICollection<Character> Characters { get; set; } = new List<Character>();
        public ICollection<Chapter> Chapters { get; set; } = new List<Chapter>();
        public ICollection<ReadingProgress> ReadingProgresses { get; set; } = new List<ReadingProgress>();
    }
}
