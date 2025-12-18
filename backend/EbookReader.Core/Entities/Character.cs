namespace EbookReader.Core.Entities
{
    public class Character
    {
        public Guid Id { get; set; }
        public Guid BookId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string? VoiceId { get; set; }
        public string? VoiceProvider { get; set; } // "OpenAI", "ElevenLabs", "GoogleCloud"
        public DateTime CreatedAt { get; set; }
        
        public Book Book { get; set; } = null!;
    }
}
