using System.IO.Compression;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Blog.Api;

// Backup og gendannelse af hele indholdet. Zip-filen indeholder både
// postmetadata, Markdown/HTML og de rå mediebytes, så den kan flyttes til en
// frisk database uden at afhænge af Git eller webhotellets filsystem.
public static class BlogBackup
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task<byte[]> CreateAsync(BlogDb db)
    {
        await Gate.WaitAsync();
        try
        {
            using var stream = new MemoryStream();
            await WriteAsync(db, stream);
            return stream.ToArray();
        }
        finally
        {
            Gate.Release();
        }
    }

    public static async Task<string> CreateFileAsync(BlogDb db, string directory)
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"blog-backup-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip");
        await Gate.WaitAsync();
        try
        {
            await using var stream = File.Create(path);
            await WriteAsync(db, stream);
        }
        finally
        {
            Gate.Release();
        }
        return path;
    }

    private static async Task WriteAsync(BlogDb db, Stream output)
    {
        var posts = await db.Posts.AsNoTracking().OrderBy(p => p.Id).ToListAsync();
        var media = await db.Media.AsNoTracking().OrderBy(m => m.Id).ToListAsync();

        using var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true);
        var manifest = new BackupManifest(
            "blog-backup",
            1,
            DateTime.UtcNow,
            posts.Count,
            media.Count);
        await WriteJson(zip, "manifest.json", manifest);
        await WriteJson(zip, "posts.json", posts.Select(BackupPost.From).ToList());

        var mediaRows = new List<BackupMedia>();
        foreach (var item in media)
        {
            var entryName = $"media/{item.Id}-{Safe(item.FileName)}";
            var entry = zip.CreateEntry(entryName, CompressionLevel.Fastest);
            await using (var entryStream = entry.Open())
                await entryStream.WriteAsync(item.Bytes);
            mediaRows.Add(BackupMedia.From(item, entryName));
        }
        await WriteJson(zip, "media.json", mediaRows);
    }

    public static async Task<BackupRestoreResult> RestoreAsync(BlogDb db, Stream input)
    {
        using var zip = new ZipArchive(input, ZipArchiveMode.Read, leaveOpen: true);
        var posts = await ReadJson<List<BackupPost>>(zip, "posts.json") ?? [];
        var media = await ReadJson<List<BackupMedia>>(zip, "media.json") ?? [];
        var postsAdded = 0;
        var postsUpdated = 0;
        var mediaAdded = 0;
        var mediaUpdated = 0;

        foreach (var source in posts)
        {
            if (!IsValidSlug(source.Slug)) continue;
            var post = await db.Posts.FirstOrDefaultAsync(p => p.Slug == source.Slug);
            var isNew = post is null;
            post ??= new BlogPost { Slug = source.Slug };
            var before = isNew ? null : JsonSerializer.Serialize(PostSnapshot(post), Json);
            if (!isNew && before is not null)
                db.Revisions.Add(RevisionFor(post, before));

            post.Title = Clean(source.Title, 200) is { Length: > 0 } title ? title : post.Slug;
            post.Description = Clean(source.Description, 600) is { Length: > 0 } value ? value : null;
            post.BodyMarkdown = source.BodyMarkdown ?? "";
            post.BodyHtml = source.BodyHtml ?? "";
            post.Tldr = Clean(source.Tldr, 1000) is { Length: > 0 } tldr ? tldr : null;
            post.PublishDate = AsUtc(source.PublishDate, DateTime.UtcNow);
            post.UpdatedAt = source.UpdatedAt is { } updated ? AsUtc(updated, DateTime.UtcNow) : null;
            post.Draft = source.Draft;
            post.TagsJson = source.TagsJson ?? "[]";
            post.SitesJson = source.SitesJson ?? "[]";
            post.LinksJson = source.LinksJson ?? "[]";
            post.Cover = Clean(source.Cover, 500) is { Length: > 0 } cover ? cover : null;
            post.Video = Clean(source.Video, 500) is { Length: > 0 } video ? video : null;
            post.VideoFormat = source.VideoFormat is "lodret" or "vandret" ? source.VideoFormat : null;
            post.Font = source.Font is "sans" or "mono" or "haandskrift" ? source.Font : "serif";
            post.Voice = Clean(source.Voice, 500) is { Length: > 0 } voice ? voice : null;
            post.Captions = Clean(source.Captions, 500) is { Length: > 0 } captions ? captions : null;
            post.Archived = source.Archived;
            post.DeletedAt = source.DeletedAt is { } deleted ? AsUtc(deleted, DateTime.UtcNow) : null;
            post.ReadingMinutes = source.ReadingMinutes is > 0 and < 1000 ? source.ReadingMinutes : 1;
            post.InteractiveJson = source.InteractiveJson ?? "{\"comments\":true,\"highlights\":true,\"graffiti\":true,\"readAloud\":true}";
            post.CreatedAt = AsUtc(source.CreatedAt, DateTime.UtcNow);
            if (isNew)
            {
                db.Posts.Add(post);
                postsAdded++;
            }
            else postsUpdated++;
        }

        foreach (var source in media)
        {
            var entry = zip.GetEntry(source.Entry);
            if (entry is null) continue;
            await using var entryStream = entry.Open();
            using var memory = new MemoryStream();
            await entryStream.CopyToAsync(memory);
            if (memory.Length == 0 || memory.Length > 45_000_000) continue;

            var item = source.PublicPath is { Length: > 0 }
                ? await db.Media.FirstOrDefaultAsync(m => m.PublicPath == source.PublicPath)
                : await db.Media.FirstOrDefaultAsync(m => m.FileName == source.FileName && m.PostSlug == source.PostSlug);
            var isNew = item is null;
            item ??= new BlogMedia();
            item.PostSlug = Clean(source.PostSlug, 120) is { Length: > 0 } postSlug ? postSlug : null;
            item.FileName = Clean(source.FileName, 255) is { Length: > 0 } name ? name : "fil";
            item.ContentType = Clean(source.ContentType, 120) is { Length: > 0 } type ? type : "application/octet-stream";
            item.PublicPath = Clean(source.PublicPath, 500) is { Length: > 0 } path ? path : null;
            item.Bytes = memory.ToArray();
            item.CreatedAt = AsUtc(source.CreatedAt, DateTime.UtcNow);
            if (isNew)
            {
                db.Media.Add(item);
                mediaAdded++;
            }
            else mediaUpdated++;
        }

        await db.SaveChangesAsync();
        return new BackupRestoreResult(postsAdded, postsUpdated, mediaAdded, mediaUpdated);
    }

    private static object PostSnapshot(BlogPost p) => new
    {
        p.Slug, p.Title, p.Description, p.BodyMarkdown, p.BodyHtml, p.Tldr, p.PublishDate,
        p.UpdatedAt, p.Draft, p.TagsJson, p.SitesJson, p.LinksJson, p.Cover, p.Video,
        p.VideoFormat, p.Font, p.Voice, p.Captions, p.Archived, p.DeletedAt,
        p.ReadingMinutes, p.InteractiveJson, p.CreatedAt,
    };

    private static BlogPostRevision RevisionFor(BlogPost p, string snapshot) => new()
    {
        Slug = p.Slug,
        Title = p.Title,
        BodyMarkdown = p.BodyMarkdown,
        BodyHtml = p.BodyHtml,
        SnapshotJson = snapshot,
        CreatedAt = DateTime.UtcNow,
    };

    private static async Task WriteJson<T>(ZipArchive zip, string name, T value)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Fastest);
        await using var stream = entry.Open();
        await JsonSerializer.SerializeAsync(stream, value, Json);
    }

    private static async Task<T?> ReadJson<T>(ZipArchive zip, string name)
    {
        var entry = zip.GetEntry(name);
        if (entry is null) return default;
        await using var stream = entry.Open();
        return await JsonSerializer.DeserializeAsync<T>(stream, Json);
    }

    private static string Safe(string name)
    {
        var cleaned = string.Concat((name ?? "fil").Where(c => !Path.GetInvalidFileNameChars().Contains(c)));
        return cleaned.Length == 0 ? "fil" : cleaned[..Math.Min(cleaned.Length, 120)];
    }

    private static string Clean(string? value, int max)
    {
        var text = (value ?? "").Trim();
        return text.Length <= max ? text : text[..max];
    }

    private static DateTime AsUtc(DateTime value, DateTime fallback)
    {
        if (value == default) return fallback;
        return value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);
    }

    private static bool IsValidSlug(string? slug) =>
        !string.IsNullOrWhiteSpace(slug) && System.Text.RegularExpressions.Regex.IsMatch(slug, "^[a-z0-9-]{1,120}$");
}

public class BackupWorker(IServiceScopeFactory scopes, IConfiguration config, ILogger<BackupWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var dir = Path.Combine(config["Backup:Directory"] ?? Path.Combine(AppContext.BaseDirectory, "Backups"));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                Directory.CreateDirectory(dir);
                var prefix = $"blog-backup-{DateTime.UtcNow:yyyyMMdd}";
                if (!Directory.EnumerateFiles(dir, $"{prefix}*.zip").Any())
                {
                    using var scope = scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<BlogDb>();
                    var path = await BlogBackup.CreateFileAsync(db, dir);
                    logger.LogInformation("Automatisk backup gemt: {Path}", path);
                    foreach (var old in Directory.EnumerateFiles(dir, "blog-backup-*.zip").OrderByDescending(f => f).Skip(7))
                    {
                        try { File.Delete(old); } catch { }
                    }
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Automatisk backup kunne ikke gennemføres.");
            }
            await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
        }
    }
}

public record BackupManifest(string Kind, int Version, DateTime CreatedAt, int Posts, int Media);
public record BackupRestoreResult(int PostsAdded, int PostsUpdated, int MediaAdded, int MediaUpdated);

public class BackupPost
{
    public string Slug { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string BodyMarkdown { get; set; } = "";
    public string BodyHtml { get; set; } = "";
    public string? Tldr { get; set; }
    public DateTime PublishDate { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public bool Draft { get; set; }
    public string TagsJson { get; set; } = "[]";
    public string SitesJson { get; set; } = "[]";
    public string LinksJson { get; set; } = "[]";
    public string? Cover { get; set; }
    public string? Video { get; set; }
    public string? VideoFormat { get; set; }
    public string Font { get; set; } = "serif";
    public string? Voice { get; set; }
    public string? Captions { get; set; }
    public bool Archived { get; set; }
    public DateTime? DeletedAt { get; set; }
    public int ReadingMinutes { get; set; } = 1;
    public string InteractiveJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }

    public static BackupPost From(BlogPost p) => new()
    {
        Slug = p.Slug, Title = p.Title, Description = p.Description, BodyMarkdown = p.BodyMarkdown,
        BodyHtml = p.BodyHtml, Tldr = p.Tldr, PublishDate = p.PublishDate, UpdatedAt = p.UpdatedAt,
        Draft = p.Draft, TagsJson = p.TagsJson, SitesJson = p.SitesJson, LinksJson = p.LinksJson,
        Cover = p.Cover, Video = p.Video, VideoFormat = p.VideoFormat, Font = p.Font, Voice = p.Voice,
        Captions = p.Captions, Archived = p.Archived, DeletedAt = p.DeletedAt,
        ReadingMinutes = p.ReadingMinutes, InteractiveJson = p.InteractiveJson, CreatedAt = p.CreatedAt,
    };
}

public class BackupMedia
{
    public string Entry { get; set; } = "";
    public string FileName { get; set; } = "";
    public string? PostSlug { get; set; }
    public string ContentType { get; set; } = "application/octet-stream";
    public string? PublicPath { get; set; }
    public DateTime CreatedAt { get; set; }

    public static BackupMedia From(BlogMedia m, string entry) => new()
    {
        Entry = entry, FileName = m.FileName, PostSlug = m.PostSlug, ContentType = m.ContentType,
        PublicPath = m.PublicPath, CreatedAt = m.CreatedAt,
    };
}