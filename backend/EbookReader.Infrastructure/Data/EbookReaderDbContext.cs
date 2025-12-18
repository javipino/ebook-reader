using EbookReader.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace EbookReader.Infrastructure.Data
{
    public class EbookReaderDbContext : DbContext
    {
        public EbookReaderDbContext(DbContextOptions<EbookReaderDbContext> options)
            : base(options)
        {
        }

        public DbSet<Book> Books { get; set; }
        public DbSet<Character> Characters { get; set; }
        public DbSet<Chapter> Chapters { get; set; }
        public DbSet<ReadingProgress> ReadingProgresses { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<Book>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Title).IsRequired().HasMaxLength(500);
                entity.Property(e => e.Author).IsRequired().HasMaxLength(200);
                entity.Property(e => e.FilePath).IsRequired();
            });

            modelBuilder.Entity<Character>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
                entity.HasOne(e => e.Book)
                    .WithMany(b => b.Characters)
                    .HasForeignKey(e => e.BookId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<Chapter>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Title).IsRequired().HasMaxLength(500);
                entity.HasOne(e => e.Book)
                    .WithMany(b => b.Chapters)
                    .HasForeignKey(e => e.BookId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<ReadingProgress>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.UserId).IsRequired().HasMaxLength(100);
                entity.HasOne(e => e.Book)
                    .WithMany(b => b.ReadingProgresses)
                    .HasForeignKey(e => e.BookId)
                    .OnDelete(DeleteBehavior.Cascade);
            });
        }
    }
}
