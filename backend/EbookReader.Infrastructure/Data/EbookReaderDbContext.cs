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

        public DbSet<User> Users { get; set; }
        public DbSet<Book> Books { get; set; }
        public DbSet<Character> Characters { get; set; }
        public DbSet<Chapter> Chapters { get; set; }
        public DbSet<ReadingProgress> ReadingProgresses { get; set; }
        public DbSet<KindleAccount> KindleAccounts { get; set; }
        public DbSet<KindleBook> KindleBooks { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<User>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Username).IsRequired().HasMaxLength(100);
                entity.Property(e => e.Email).IsRequired().HasMaxLength(255);
                entity.Property(e => e.PasswordHash).IsRequired();
                entity.Property(e => e.PreferredTtsProvider).IsRequired().HasMaxLength(20).HasDefaultValue("elevenlabs");
                entity.Property(e => e.PreferredAzureVoiceName).HasMaxLength(100);
                entity.HasIndex(e => e.Username).IsUnique();
                entity.HasIndex(e => e.Email).IsUnique();
            });

            modelBuilder.Entity<Book>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Title).IsRequired().HasMaxLength(500);
                entity.Property(e => e.Author).IsRequired().HasMaxLength(200);
                entity.Property(e => e.FilePath).IsRequired(false); // Nullable for Kindle books without downloaded file
                entity.HasOne(e => e.User)
                    .WithMany(u => u.Books)
                    .HasForeignKey(e => e.UserId)
                    .OnDelete(DeleteBehavior.Cascade);
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
                entity.HasOne(e => e.Book)
                    .WithMany(b => b.ReadingProgresses)
                    .HasForeignKey(e => e.BookId)
                    .OnDelete(DeleteBehavior.Cascade);
                entity.HasOne(e => e.User)
                    .WithMany(u => u.ReadingProgresses)
                    .HasForeignKey(e => e.UserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<KindleAccount>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.AmazonEmail).IsRequired().HasMaxLength(500);
                entity.Property(e => e.EncryptedCredentials).IsRequired();
                entity.Property(e => e.Marketplace).IsRequired().HasMaxLength(10);
                entity.HasOne(e => e.User)
                    .WithMany()
                    .HasForeignKey(e => e.UserId)
                    .OnDelete(DeleteBehavior.Cascade);
                entity.HasIndex(e => e.UserId).IsUnique(); // One Kindle account per user
            });

            modelBuilder.Entity<KindleBook>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Asin).IsRequired().HasMaxLength(50);
                entity.HasOne(e => e.Book)
                    .WithMany()
                    .HasForeignKey(e => e.BookId)
                    .OnDelete(DeleteBehavior.Cascade);
                entity.HasOne(e => e.KindleAccount)
                    .WithMany()
                    .HasForeignKey(e => e.KindleAccountId)
                    .OnDelete(DeleteBehavior.Cascade);
                entity.HasIndex(e => new { e.KindleAccountId, e.Asin }).IsUnique();
            });
        }
    }
}

