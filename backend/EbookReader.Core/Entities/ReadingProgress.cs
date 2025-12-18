namespace EbookReader.Core.Entities
{
    public class ReadingProgress
    {
        public Guid Id { get; set; }
        public Guid BookId { get; set; }
        public Guid UserId { get; set; }
        public int CurrentChapterNumber { get; set; }
        public int CurrentPosition { get; set; }
        public DateTime LastRead { get; set; }
        public bool IsListening { get; set; }
        
        public Book Book { get; set; } = null!;
        public User User { get; set; } = null!;
    }
}
