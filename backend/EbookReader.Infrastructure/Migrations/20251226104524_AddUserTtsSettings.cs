using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EbookReader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUserTtsSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PreferredAzureVoiceName",
                table: "Users",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PreferredTtsProvider",
                table: "Users",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "elevenlabs");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PreferredAzureVoiceName",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "PreferredTtsProvider",
                table: "Users");
        }
    }
}
