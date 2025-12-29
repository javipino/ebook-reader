FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080
EXPOSE 8081

# Debug stage for VS debugging
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS debug
WORKDIR /src
EXPOSE 8080
EXPOSE 8081

# Install vsdbg for remote debugging
RUN apt-get update && apt-get install -y curl unzip procps \
    && curl -sSL https://aka.ms/getvsdbgsh | bash /dev/stdin -v latest -l /vsdbg \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY ["EbookReader.Core/EbookReader.Core.csproj", "EbookReader.Core/"]
COPY ["EbookReader.Infrastructure/EbookReader.Infrastructure.csproj", "EbookReader.Infrastructure/"]
COPY ["EbookReader.API/EbookReader.API.csproj", "EbookReader.API/"]

# Restore dependencies
RUN dotnet restore "EbookReader.API/EbookReader.API.csproj"

# Copy source code
COPY . .
WORKDIR "/src/EbookReader.API"

ENTRYPOINT ["dotnet", "watch", "run", "--project", "/src/EbookReader.API/EbookReader.API.csproj", "--urls", "https://+:8081;http://+:8080"]

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy project files
COPY ["EbookReader.Core/EbookReader.Core.csproj", "EbookReader.Core/"]
COPY ["EbookReader.Infrastructure/EbookReader.Infrastructure.csproj", "EbookReader.Infrastructure/"]
COPY ["EbookReader.API/EbookReader.API.csproj", "EbookReader.API/"]

# Restore dependencies
RUN dotnet restore "EbookReader.API/EbookReader.API.csproj"

# Copy source code
COPY . .

# Build the project
WORKDIR "/src/EbookReader.API"
RUN dotnet build "EbookReader.API.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "EbookReader.API.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app

# Install vsdbg for remote debugging
RUN apt-get update && apt-get install -y curl unzip \
    && curl -sSL https://aka.ms/getvsdbgsh | bash /dev/stdin -v latest -l /vsdbg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "EbookReader.API.dll"]
