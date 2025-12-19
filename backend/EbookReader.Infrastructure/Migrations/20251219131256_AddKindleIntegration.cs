using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EbookReader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddKindleIntegration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "KindleAccounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AmazonEmail = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    EncryptedCredentials = table.Column<string>(type: "text", nullable: false),
                    LastSyncedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastSyncError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Marketplace = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KindleAccounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_KindleAccounts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "KindleBooks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BookId = table.Column<Guid>(type: "uuid", nullable: false),
                    KindleAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Asin = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LastKindlePosition = table.Column<int>(type: "integer", nullable: false),
                    LastKindlePositionUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KindleBooks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_KindleBooks_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_KindleBooks_KindleAccounts_KindleAccountId",
                        column: x => x.KindleAccountId,
                        principalTable: "KindleAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_KindleAccounts_UserId",
                table: "KindleAccounts",
                column: "UserId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_KindleBooks_BookId",
                table: "KindleBooks",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_KindleBooks_KindleAccountId_Asin",
                table: "KindleBooks",
                columns: new[] { "KindleAccountId", "Asin" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "KindleBooks");

            migrationBuilder.DropTable(
                name: "KindleAccounts");
        }
    }
}
