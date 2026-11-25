using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Blog.Api;

// Alle tabeller hedder blog_* så de kan ligge i en database sammen med andre sites.
public class BlogDb(DbContextOptions<BlogDb> options) : DbContext(options)
{
    public DbSet<Vote> Votes => Set<Vote>();
    public DbSet<StanceAnswer> Stances => Set<StanceAnswer>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<Annotation> Annotations => Set<Annotation>();
    public DbSet<Stroke> Strokes => Set<Stroke>();
    public DbSet<BlogPost> Posts => Set<BlogPost>();
    public DbSet<BlogMedia> Media => Set<BlogMedia>();
    public DbSet<BlogPostRevision> Revisions => Set<BlogPostRevision>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Vote>(e =>
        {
            e.ToTable("blog_votes");
            e.HasIndex(x => new { x.Post, x.PollId, x.Voter }).IsUnique();
        });
        b.Entity<StanceAnswer>(e =>
        {
            e.ToTable("blog_stances");
            e.HasIndex(x => new { x.Post, x.StanceId, x.Voter }).IsUnique();
        });
        b.Entity<Comment>(e => { e.ToTable("blog_comments"); e.HasIndex(x => x.Post); });
        b.Entity<Annotation>(e => { e.ToTable("blog_annotations"); e.HasIndex(x => x.Post); });
        b.Entity<Stroke>(e => { e.ToTable("blog_strokes"); e.HasIndex(x => x.Post); });
        BlogContentSchema.ConfigurePost(b);
        BlogContentSchema.ConfigureMedia(b);
        BlogContentSchema.ConfigureRevision(b);
        BlogContentSchema.ConfigureAudit(b);
    }

    // Tidspunkter gemmes i UTC og skal læses tilbage som UTC.
    protected override void ConfigureConventions(ModelConfigurationBuilder c) =>
        c.Properties<DateTime>().HaveConversion<UtcConverter>();

    private class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => v.ToUniversalTime(), v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
}

// Indholdet på bloggen. Alt her ligger i MySQL på webhotellet – ikke i Git.
public class BlogPost
{
    public int Id { get; set; }
    [MaxLength(120)] public string Slug { get; set; } = "";
    [MaxLength(200)] public string Title { get; set; } = "";
    [MaxLength(600)] public string? Description { get; set; }
    public string BodyMarkdown { get; set; } = "";
    public string BodyHtml { get; set; } = "";
    [MaxLength(1000)] public string? Tldr { get; set; }
    public DateTime PublishDate { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public bool Draft { get; set; }
    [MaxLength(2000)] public string TagsJson { get; set; } = "[]";
    [MaxLength(2000)] public string SitesJson { get; set; } = "[]";
    public string LinksJson { get; set; } = "[]";
    [MaxLength(500)] public string? Cover { get; set; }
    [MaxLength(500)] public string? Video { get; set; }
    [MaxLength(20)] public string? VideoFormat { get; set; }
    [MaxLength(20)] public string Font { get; set; } = "serif";
    [MaxLength(500)] public string? Voice { get; set; }
    public bool Archived { get; set; }
    public DateTime? DeletedAt { get; set; }
    [MaxLength(500)] public string? Captions { get; set; }
    public int ReadingMinutes { get; set; } = 1;
    public string InteractiveJson { get; set; } = "{\"comments\":true,\"highlights\":true,\"graffiti\":true,\"readAloud\":true}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class BlogMedia
{
    public int Id { get; set; }
    [MaxLength(120)] public string? PostSlug { get; set; }
    [MaxLength(255)] public string FileName { get; set; } = "";
    [MaxLength(120)] public string ContentType { get; set; } = "application/octet-stream";
    // Den gamle offentlige sti, fx /media/zoher4cl/hypo.jpg. Bevarer gamle billed-URL'er.
    [MaxLength(500)] public string? PublicPath { get; set; }
    public byte[] Bytes { get; set; } = [];
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// En letvægtshistorik, så en fejlretning eller en uheldig sletning kan rulles tilbage.
public class BlogPostRevision
{
    public int Id { get; set; }
    [MaxLength(120)] public string Slug { get; set; } = "";
    [MaxLength(200)] public string Title { get; set; } = "";
    public string BodyMarkdown { get; set; } = "";
    public string BodyHtml { get; set; } = "";
    public string SnapshotJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class AuditEntry
{
    public int Id { get; set; }
    [MaxLength(40)] public string Action { get; set; } = "";
    [MaxLength(40)] public string Entity { get; set; } = "";
    [MaxLength(120)] public string? EntityId { get; set; }
    [MaxLength(1000)] public string? Detail { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// Små contexts bruges kun til at oprette de nye tabeller på en eksisterende database.
// Den store BlogDb kan ikke gøre det, fordi de gamle tabeller allerede findes.
public class BlogPostStoreDb(DbContextOptions<BlogPostStoreDb> options) : DbContext(options)
{
    public DbSet<BlogPost> Posts => Set<BlogPost>();
    protected override void OnModelCreating(ModelBuilder b) => BlogContentSchema.ConfigurePost(b);
}

public class BlogMediaStoreDb(DbContextOptions<BlogMediaStoreDb> options) : DbContext(options)
{
    public DbSet<BlogMedia> Media => Set<BlogMedia>();
    protected override void OnModelCreating(ModelBuilder b) => BlogContentSchema.ConfigureMedia(b);
}

public class BlogRevisionStoreDb(DbContextOptions<BlogRevisionStoreDb> options) : DbContext(options)
{
    public DbSet<BlogPostRevision> Revisions => Set<BlogPostRevision>();
    protected override void OnModelCreating(ModelBuilder b) => BlogContentSchema.ConfigureRevision(b);
}

public class BlogAuditStoreDb(DbContextOptions<BlogAuditStoreDb> options) : DbContext(options)
{
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();
    protected override void OnModelCreating(ModelBuilder b) => BlogContentSchema.ConfigureAudit(b);
}

public abstract class PostItem
{
    public int Id { get; set; }
    [MaxLength(120)] public string Post { get; set; } = "";
    [MaxLength(36)] public string Voter { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class BlogContentSchema
{
    public static void ConfigurePost(ModelBuilder b) =>
        b.Entity<BlogPost>(e =>
        {
            e.ToTable("blog_posts");
            e.HasIndex(x => x.Slug).IsUnique();
            e.HasIndex(x => new { x.Draft, x.PublishDate });
        });

    public static void ConfigureMedia(ModelBuilder b) =>
        b.Entity<BlogMedia>(e =>
        {
            e.ToTable("blog_media");
            e.HasIndex(x => x.PostSlug);
            e.HasIndex(x => x.PublicPath);
        });

    public static void ConfigureRevision(ModelBuilder b) =>
        b.Entity<BlogPostRevision>(e =>
        {
            e.ToTable("blog_post_revisions");
            e.HasIndex(x => new { x.Slug, x.CreatedAt });
        });

    public static void ConfigureAudit(ModelBuilder b) =>
        b.Entity<AuditEntry>(e =>
        {
            e.ToTable("blog_audit_log");
            e.HasIndex(x => x.CreatedAt);
        });
}

public class Vote : PostItem
{
    [MaxLength(80)] public string PollId { get; set; } = "";
    public int Option { get; set; }
}

public class StanceAnswer : PostItem
{
    [MaxLength(80)] public string StanceId { get; set; } = "";
    public int Value { get; set; }
}

public class Comment : PostItem
{
    [MaxLength(60)] public string Name { get; set; } = "";
    [MaxLength(4000)] public string Body { get; set; } = "";
}

public class Annotation : PostItem
{
    [MaxLength(20)] public string Kind { get; set; } = "understregning";
    [MaxLength(600)] public string Quote { get; set; } = "";
    [MaxLength(64)] public string Prefix { get; set; } = "";
    [MaxLength(64)] public string Suffix { get; set; } = "";
    [MaxLength(1000)] public string? Note { get; set; }
    [MaxLength(60)] public string? Name { get; set; }
}

public class Stroke : PostItem
{
    [MaxLength(7)] public string Color { get; set; } = "#c8402a";
    public double Width { get; set; } = 4;
    // JSON: [[x,y],[x,y],...] i enheder af 1/1000 af artiklens bredde.
    public string Points { get; set; } = "[]";
}
