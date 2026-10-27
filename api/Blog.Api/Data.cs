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
    }

    // Tidspunkter gemmes i UTC og skal læses tilbage som UTC.
    protected override void ConfigureConventions(ModelConfigurationBuilder c) =>
        c.Properties<DateTime>().HaveConversion<UtcConverter>();

    private class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => v.ToUniversalTime(), v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
}

public abstract class PostItem
{
    public int Id { get; set; }
    [MaxLength(120)] public string Post { get; set; } = "";
    [MaxLength(36)] public string Voter { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
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
