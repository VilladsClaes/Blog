using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Blog.Api;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Annotation = Blog.Api.Annotation;
using Microsoft.EntityFrameworkCore.Storage;

var builder = WebApplication.CreateBuilder(args);

// "Data Source=..." = SQLite (lokal udvikling), alt andet = MySQL hos Simply.
var connection = builder.Configuration.GetConnectionString("Database") ?? "Data Source=blog.db";
builder.Services.AddDbContext<BlogDb>(o =>
{
    if (connection.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase)) o.UseSqlite(connection);
    else o.UseMySQL(connection);
});

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("skriv", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "ukendt",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();
var adminKey = app.Configuration["Admin:Key"];

await EnsureTables(app);

app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    await next();
});

// Gamle adresser fra Articulate-bloggen.
app.MapGet("/archive/{slug}", (string slug) => Results.Redirect($"/{slug}/", permanent: true));
app.MapGet("/Kategorier", () => Results.Redirect("/emner/", permanent: true));
app.MapGet("/tags/{**rest}", () => Results.Redirect("/emner/", permanent: true));
app.MapGet("/rss", () => Results.Redirect("/rss.xml", permanent: true));

var contentTypes = new FileExtensionContentTypeProvider();
contentTypes.Mappings[".yml"] = "text/yaml; charset=utf-8";
contentTypes.Mappings[".webmanifest"] = "application/manifest+json";
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    OnPrepareResponse = f =>
    {
        var path = f.Context.Request.Path.Value ?? "";
        var headers = f.Context.Response.Headers;
        if (path.StartsWith("/_astro/")) headers.CacheControl = "public, max-age=31536000, immutable";
        else if (path.StartsWith("/media/")) headers.CacheControl = "public, max-age=604800";
        else headers.CacheControl = "public, max-age=300";
        // Dine andre sites må hente feeds og embed.js.
        if (path.StartsWith("/feeds/") || path == "/embed.js") headers.AccessControlAllowOrigin = "*";
    },
});
// Routing efter de statiske filer, ellers "stjæler" 404-fallbacken alle sider.
app.UseRouting();
app.UseRateLimiter();

var api = app.MapGroup("/api/posts/{slug}");

api.MapGet("/state", async (string slug, string? voter, BlogDb db) =>
{
    if (!ValidPost(slug)) return Results.NotFound();
    voter ??= "";
    var votes = await db.Votes.Where(v => v.Post == slug).Select(v => new { v.PollId, v.Option, v.Voter }).ToListAsync();
    var stances = await db.Stances.Where(v => v.Post == slug).Select(v => new { v.StanceId, v.Value, v.Voter }).ToListAsync();
    var comments = await db.Comments.Where(c => c.Post == slug).OrderBy(c => c.CreatedAt).ToListAsync();
    var annotations = await db.Annotations.Where(a => a.Post == slug).OrderBy(a => a.CreatedAt).ToListAsync();
    var strokes = await db.Strokes.Where(s => s.Post == slug).OrderBy(s => s.CreatedAt).ToListAsync();
    return Results.Ok(new
    {
        polls = votes.GroupBy(v => v.PollId).ToDictionary(g => g.Key, g => Choice(g.Select(v => (v.Option, v.Voter)), voter)),
        stances = stances.GroupBy(v => v.StanceId).ToDictionary(g => g.Key, g => Choice(g.Select(v => (v.Value, v.Voter)), voter)),
        comments = comments.Select(c => CommentDto(c, voter)),
        annotations = annotations.Select(a => AnnotationDto(a, voter)),
        strokes = strokes.Select(s => StrokeDto(s, voter)),
    });
});

api.MapPost("/polls/{pollId}", async (string slug, string pollId, ChoiceInput input, BlogDb db) =>
{
    if (!ValidPost(slug) || !ValidId(pollId) || !ValidVoter(input.Voter) || input.Option is < 0 or > 19) return Results.BadRequest();
    var vote = await db.Votes.FirstOrDefaultAsync(v => v.Post == slug && v.PollId == pollId && v.Voter == input.Voter);
    if (vote is null) db.Votes.Add(new Vote { Post = slug, PollId = pollId, Voter = input.Voter!, Option = input.Option!.Value });
    else vote.Option = input.Option!.Value;
    await db.SaveChangesAsync();
    var all = await db.Votes.Where(v => v.Post == slug && v.PollId == pollId).Select(v => new { v.Option, v.Voter }).ToListAsync();
    return Results.Ok(Choice(all.Select(v => (v.Option, v.Voter)), input.Voter!));
}).RequireRateLimiting("skriv");

api.MapPost("/stances/{stanceId}", async (string slug, string stanceId, ChoiceInput input, BlogDb db) =>
{
    if (!ValidPost(slug) || !ValidId(stanceId) || !ValidVoter(input.Voter) || input.Value is < 1 or > 5) return Results.BadRequest();
    var answer = await db.Stances.FirstOrDefaultAsync(v => v.Post == slug && v.StanceId == stanceId && v.Voter == input.Voter);
    if (answer is null) db.Stances.Add(new StanceAnswer { Post = slug, StanceId = stanceId, Voter = input.Voter!, Value = input.Value!.Value });
    else answer.Value = input.Value!.Value;
    await db.SaveChangesAsync();
    var all = await db.Stances.Where(v => v.Post == slug && v.StanceId == stanceId).Select(v => new { v.Value, v.Voter }).ToListAsync();
    return Results.Ok(Choice(all.Select(v => (v.Value, v.Voter)), input.Voter!));
}).RequireRateLimiting("skriv");

api.MapPost("/comments", async (string slug, CommentInput input, BlogDb db) =>
{
    if (!string.IsNullOrEmpty(input.Website)) return Results.BadRequest(); // honningkrukke mod spam-robotter
    var name = Clean(input.Name, 60);
    var body = Clean(input.Body, 4000, multiline: true);
    if (!ValidPost(slug) || !ValidVoter(input.Voter) || name.Length == 0 || body.Length == 0) return Results.BadRequest();
    var c = new Comment { Post = slug, Voter = input.Voter!, Name = name, Body = body };
    db.Comments.Add(c);
    await db.SaveChangesAsync();
    return Results.Ok(CommentDto(c, input.Voter!));
}).RequireRateLimiting("skriv");

api.MapPost("/annotations", async (string slug, AnnotationInput input, BlogDb db) =>
{
    var kind = input.Kind == "note" ? "note" : "understregning";
    var quote = (input.Quote ?? "").Trim();
    var note = Clean(input.Note, 1000, multiline: true);
    if (!ValidPost(slug) || !ValidVoter(input.Voter) || quote.Length is < 2 or > 600 || (kind == "note" && note.Length == 0)) return Results.BadRequest();
    var a = new Annotation
    {
        Post = slug, Voter = input.Voter!, Kind = kind, Quote = quote,
        Prefix = Truncate(input.Prefix, 64), Suffix = Truncate(input.Suffix, 64),
        Note = kind == "note" ? note : null, Name = Clean(input.Name, 60) is { Length: > 0 } n ? n : null,
    };
    db.Annotations.Add(a);
    await db.SaveChangesAsync();
    return Results.Ok(AnnotationDto(a, input.Voter!));
}).RequireRateLimiting("skriv");

api.MapPost("/strokes", async (string slug, StrokeInput input, BlogDb db) =>
{
    if (!ValidPost(slug) || !ValidVoter(input.Voter) || input.Points is not { Length: > 0 and <= 1500 }) return Results.BadRequest();
    if (input.Points.Any(p => p.Length != 2 || p.Any(n => !double.IsFinite(n) || n < -50 || n > 200_000))) return Results.BadRequest();
    var color = input.Color is { } c && Regex.IsMatch(c, "^#[0-9a-fA-F]{6}$") ? c : "#c8402a";
    var s = new Stroke
    {
        Post = slug, Voter = input.Voter!, Color = color, Width = Math.Clamp(input.Width ?? 4, 1, 20),
        Points = JsonSerializer.Serialize(input.Points.Select(p => p.Select(n => Math.Round(n, 1)))),
    };
    db.Strokes.Add(s);
    await db.SaveChangesAsync();
    return Results.Ok(StrokeDto(s, input.Voter!));
}).RequireRateLimiting("skriv");

// Man kan slette sine egne ting. Med X-Admin-Key kan alt slettes (moderation).
MapDelete<Comment>("comments", db => db.Comments);
MapDelete<Annotation>("annotations", db => db.Annotations);
MapDelete<Stroke>("strokes", db => db.Strokes);

void MapDelete<T>(string route, Func<BlogDb, DbSet<T>> set) where T : PostItem =>
    api.MapDelete($"/{route}/{{id:int}}", async (string slug, int id, string? voter, HttpRequest req, BlogDb db) =>
    {
        var item = await set(db).FirstOrDefaultAsync(x => x.Id == id && x.Post == slug);
        if (item is null) return Results.NotFound();
        if (item.Voter != voter && !IsAdmin(req)) return Results.Forbid();
        set(db).Remove(item);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }).RequireRateLimiting("skriv");

// Overblik til moderation: GET /api/admin/seneste med headeren X-Admin-Key.
app.MapGet("/api/admin/seneste", async (HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    return Results.Ok(new
    {
        comments = await db.Comments.OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(),
        annotations = await db.Annotations.OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(),
        strokes = await db.Strokes.OrderByDescending(x => x.CreatedAt).Take(100).Select(x => new { x.Id, x.Post, x.Color, x.CreatedAt }).ToListAsync(),
    });
});

app.MapGet("/api/health", () => Results.Ok(new { ok = true }));

// Ukendte adresser får sitets egen 404-side.
app.MapFallback(async ctx =>
{
    ctx.Response.StatusCode = 404;
    var notFound = app.Environment.WebRootFileProvider.GetFileInfo("404.html");
    if (notFound.Exists)
    {
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.SendFileAsync(notFound);
    }
});

app.Run();

bool IsAdmin(HttpRequest req) =>
    !string.IsNullOrEmpty(adminKey) && req.Headers["X-Admin-Key"] == adminKey;

// I produktion findes et indlæg kun, hvis Astro har bygget en side til det.
bool ValidPost(string slug) =>
    Regex.IsMatch(slug, "^[a-z0-9-]{1,120}$") &&
    (app.Environment.IsDevelopment() || app.Environment.WebRootFileProvider.GetFileInfo($"{slug}/index.html").Exists);

static bool ValidId(string id) => Regex.IsMatch(id, "^[a-z0-9-]{1,80}$");
static bool ValidVoter(string? voter) => Guid.TryParse(voter, out _);
static string Truncate(string? s, int max) => s is null ? "" : s.Length <= max ? s : s[..max];

static string Clean(string? s, int max, bool multiline = false)
{
    s = (s ?? "").Trim();
    s = multiline ? Regex.Replace(s, @"\n{3,}", "\n\n") : Regex.Replace(s, @"\s+", " ");
    return Truncate(s, max);
}

static object Choice(IEnumerable<(int Value, string Voter)> answers, string voter)
{
    var list = answers.ToList();
    return new
    {
        counts = list.GroupBy(a => a.Value).ToDictionary(g => g.Key.ToString(), g => g.Count()),
        mine = list.Where(a => a.Voter == voter).Select(a => (int?)a.Value).FirstOrDefault(),
    };
}

static object CommentDto(Comment c, string voter) => new { c.Id, c.Name, c.Body, c.CreatedAt, mine = c.Voter == voter };
static object AnnotationDto(Annotation a, string voter) => new { a.Id, a.Kind, a.Quote, a.Prefix, a.Suffix, a.Note, a.Name, a.CreatedAt, mine = a.Voter == voter };
static object StrokeDto(Stroke s, string voter) => new { s.Id, s.Color, s.Width, points = JsonSerializer.Deserialize<double[][]>(s.Points), mine = s.Voter == voter };

static async Task EnsureTables(WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<BlogDb>();
    try
    {
        await db.Comments.AnyAsync();
    }
    catch
    {
        // Databasen kan være delt med andre sites, så vi opretter kun vores egne tabeller.
        var creator = db.GetService<IRelationalDatabaseCreator>();
        if (!await creator.ExistsAsync()) await creator.CreateAsync();
        await creator.CreateTablesAsync();
    }
}

record ChoiceInput(string? Voter, int? Option, int? Value);
record CommentInput(string? Voter, string? Name, string? Body, string? Website);
record AnnotationInput(string? Voter, string? Kind, string? Quote, string? Prefix, string? Suffix, string? Note, string? Name);
record StrokeInput(string? Voter, string? Color, double? Width, double[][]? Points);
