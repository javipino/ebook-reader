namespace EbookReader.Core.Entities
{
    public class Chapter
    {
        public Guid Id { get; set; }
        public Guid BookId { get; set; }
        public int ChapterNumber { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;
        public int WordCount { get; set; }
        public bool AudioGenerated { get; set; }
        public string? AudioFilePath { get; set; }
        
        public Book Book { get; set; } = null!;
    }
}
