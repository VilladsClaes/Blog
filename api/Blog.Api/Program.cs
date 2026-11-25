using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Blog.Api;
using Microsoft.AspNetCore.Http.Features;
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

builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 50_000_000);
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = 50_000_000);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("skriv", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "ukendt",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("admin", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "ukendt",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1) }));
});
builder.Services.AddHostedService<BackupWorker>();

var app = builder.Build();
var adminKey = app.Configuration["Admin:Key"];

await EnsureTables(app);
await EnsurePostColumns(connection);
await EnsureContentTables(connection);
await EnsureMediaPublicPath(connection);
await SeedPosts(app);
await SeedMedia(app);

app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers.XFrameOptions = "SAMEORIGIN";
    ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    ctx.Response.Headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()";
    await next();
});

// Alt indhold hentes fra databasen. De statiske Astro-sider bruges som
// skabeloner og som fallback, hvis databasen endnu ikke har et indlæg.
// Vigtigt: dette middleware ligger før UseStaticFiles, så et indlæg i
// blog_posts vinder over en gammel statisk <slug>/index.html.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Method is not ("GET" or "HEAD"))
    {
        await next();
        return;
    }

    var path = ctx.Request.Path.Value ?? "";
    var cleanPath = path.TrimEnd('/');
    if (cleanPath.Length == 0) cleanPath = "/";

    // Skabelonerne er kun til API'ets udfyldning, ikke offentlige sider.
    if (cleanPath is "/emner/topic-shell" or "/sites/site-shell")
    {
        ctx.Response.StatusCode = 404;
        var notFound = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "404.html");
        if (File.Exists(notFound))
        {
            ctx.Response.ContentType = "text/html; charset=utf-8";
            await ctx.Response.SendFileAsync(notFound);
        }
        return;
    }

    try
    {
        var db = ctx.RequestServices.GetRequiredService<BlogDb>();

        if (path == "/rss.xml")
        {
            await WriteRss(ctx, db);
            return;
        }

        if (path.StartsWith("/feeds/", StringComparison.Ordinal) && path.EndsWith(".json", StringComparison.Ordinal))
        {
            var key = path["/feeds/".Length..^".json".Length];
            if (key == "alle" || BlogSites.Keys.Contains(key, StringComparer.OrdinalIgnoreCase))
            {
                await WriteFeed(ctx, db, key);
                return;
            }
        }

        if (path is "/sitemap.xml" or "/sitemap-0.xml")
        {
            await WriteSitemap(ctx, db);
            return;
        }

        if (path == "/sitemap-index.xml")
        {
            await WriteSitemapIndex(ctx, db);
            return;
        }

        if (path.StartsWith("/media/", StringComparison.Ordinal))
        {
            var media = await db.Media.AsNoTracking().FirstOrDefaultAsync(m => m.PublicPath == path);
            if (media is null)
            {
                await next();
                return;
            }

            var bytes = media.Bytes;
            ctx.Response.ContentType = media.ContentType;
            ctx.Response.Headers.CacheControl = "public, max-age=604800, immutable";
            ctx.Response.Headers.AcceptRanges = "bytes";

            // Videoafspillere bruger byte-ranges til at søge i og streame klip.
            if (TryRange(ctx.Request.Headers.Range.ToString(), bytes.Length, out var start, out var end))
            {
                var length = end - start + 1;
                ctx.Response.StatusCode = 206;
                ctx.Response.Headers.ContentRange = $"bytes {start}-{end}/{bytes.Length}";
                ctx.Response.ContentLength = length;
                if (ctx.Request.Method != "HEAD") await ctx.Response.Body.WriteAsync(bytes.AsMemory((int)start, (int)length));
                return;
            }

            ctx.Response.ContentLength = bytes.Length;
            if (ctx.Request.Method != "HEAD") await ctx.Response.Body.WriteAsync(bytes);
            return;
        }

        if (cleanPath == "/" || cleanPath == "/emner" || cleanPath == "/sites" ||
            cleanPath.StartsWith("/emner/", StringComparison.Ordinal) || cleanPath.StartsWith("/sites/", StringComparison.Ordinal))
        {
            var relative = cleanPath.Trim('/');
            var pagePath = relative.Length == 0
                ? Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html")
                : Path.Combine(app.Environment.WebRootPath ?? "wwwroot", relative, "index.html");
            var fallbackKind = "";
            if (!File.Exists(pagePath))
            {
                if (cleanPath.StartsWith("/emner/", StringComparison.Ordinal))
                {
                    pagePath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "emner", "topic-shell", "index.html");
                    fallbackKind = "topic";
                }
                else if (cleanPath.StartsWith("/sites/", StringComparison.Ordinal))
                {
                    pagePath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "sites", "site-shell", "index.html");
                    fallbackKind = "site";
                }

                if (!File.Exists(pagePath))
                {
                    await next();
                    return;
                }
            }

            var html = await File.ReadAllTextAsync(pagePath);
            var posts = await PublishedPosts(db);
            var changed = false;

            if (cleanPath == "/")
            {
                const string marker = "<div data-db-posts hidden></div>";
                if (html.Contains(marker, StringComparison.Ordinal))
                {
                    html = html.Replace(marker, RenderHomePosts(posts), StringComparison.Ordinal);
                    changed = true;
                }
            }
            else if (cleanPath == "/emner")
            {
                const string marker = "<div data-db-topics hidden></div>";
                if (html.Contains(marker, StringComparison.Ordinal))
                {
                    html = html.Replace(marker, RenderTopics(posts), StringComparison.Ordinal);
                    changed = true;
                }
            }
            else if (cleanPath.StartsWith("/emner/", StringComparison.Ordinal))
            {
                var tagSlug = cleanPath["/emner/".Length..];
                if (ValidId(tagSlug))
                {
                    var tagged = posts.Where(p => ParseList(p.TagsJson).Any(t => TagSlug(t) == tagSlug)).ToList();
                    if (fallbackKind == "topic")
                    {
                        var topicName = TopicName(posts, tagSlug);
                        if (topicName is null || tagged.Count == 0)
                        {
                            await next();
                            return;
                        }
                        html = FillTopicShell(html, topicName, tagSlug);
                        changed = true;
                    }

                    const string marker = "<div data-db-topic-posts hidden></div>";
                    const string countMarker = "<span data-db-topic-count hidden></span>";
                    if (html.Contains(marker, StringComparison.Ordinal) || html.Contains(countMarker, StringComparison.Ordinal))
                    {
                        html = html.Replace(marker, RenderPostRows(tagged, "Ingen indlæg i dette emne endnu."), StringComparison.Ordinal);
                        html = html.Replace(countMarker, $"{tagged.Count} {(tagged.Count == 1 ? "tekst" : "tekster")} i dette emne.", StringComparison.Ordinal);
                        changed = true;
                    }
                }
            }
            else if (cleanPath == "/sites")
            {
                var counts = SiteCounts(posts);
                html = ReplaceSiteCounts(html, counts);
                var extra = counts
                    .Where(kv => !BlogSites.Keys.Contains(kv.Key, StringComparer.OrdinalIgnoreCase))
                    .OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase);
                const string marker = "<div data-db-sites hidden></div>";
                if (html.Contains(marker, StringComparison.Ordinal))
                    html = html.Replace(marker, RenderExtraSites(extra), StringComparison.Ordinal);
                changed = true;
            }
            else if (cleanPath.StartsWith("/sites/", StringComparison.Ordinal))
            {
                var site = cleanPath["/sites/".Length..];
                if (ValidSlug(site))
                {
                    var sitePosts = posts.Where(p => ParseList(p.SitesJson).Contains(site, StringComparer.OrdinalIgnoreCase)).ToList();
                    if (fallbackKind == "site")
                    {
                        if (sitePosts.Count == 0)
                        {
                            await next();
                            return;
                        }
                        html = FillSiteShell(html, site);
                        changed = true;
                    }

                    const string marker = "<div data-db-site-posts hidden></div>";
                    if (html.Contains(marker, StringComparison.Ordinal))
                    {
                        html = html.Replace(marker, RenderPostRows(sitePosts, "Ingen indlæg endnu."), StringComparison.Ordinal);
                        changed = true;
                    }
                }
            }

            if (changed)
            {
                ctx.Response.ContentType = "text/html; charset=utf-8";
                await ctx.Response.WriteAsync(html);
                return;
            }

            await next();
            return;
        }

        var slug = cleanPath.Trim('/');
        if (slug.Length > 0 && !slug.Contains('/') && ValidSlug(slug) && await TryServePostAsync(ctx, db))
            return;

        await next();
    }
    catch
    {
        // Hvis databasen driller, skal de statiske sider stadig kunne vises.
        await next();
    }
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
    if (!await ValidPostAsync(slug, db)) return Results.NotFound();
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
    if (!await ValidPostAsync(slug, db) || !ValidId(pollId) || !ValidVoter(input.Voter) || input.Option is < 0 or > 19) return Results.BadRequest();
    var vote = await db.Votes.FirstOrDefaultAsync(v => v.Post == slug && v.PollId == pollId && v.Voter == input.Voter);
    if (vote is null) db.Votes.Add(new Vote { Post = slug, PollId = pollId, Voter = input.Voter!, Option = input.Option!.Value });
    else vote.Option = input.Option!.Value;
    await db.SaveChangesAsync();
    var all = await db.Votes.Where(v => v.Post == slug && v.PollId == pollId).Select(v => new { v.Option, v.Voter }).ToListAsync();
    return Results.Ok(Choice(all.Select(v => (v.Option, v.Voter)), input.Voter!));
}).RequireRateLimiting("skriv");

api.MapPost("/stances/{stanceId}", async (string slug, string stanceId, ChoiceInput input, BlogDb db) =>
{
    if (!await ValidPostAsync(slug, db) || !ValidId(stanceId) || !ValidVoter(input.Voter) || input.Value is < 1 or > 5) return Results.BadRequest();
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
    if (!await ValidPostAsync(slug, db) || !ValidVoter(input.Voter) || name.Length == 0 || body.Length == 0) return Results.BadRequest();
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
    if (!await ValidPostAsync(slug, db) || !ValidVoter(input.Voter) || quote.Length is < 2 or > 600 || (kind == "note" && note.Length == 0)) return Results.BadRequest();
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
    if (!await ValidPostAsync(slug, db) || !ValidVoter(input.Voter) || input.Points is not { Length: > 0 and <= 1500 }) return Results.BadRequest();
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
        // Ikke Results.Forbid(): den kræver et authentication-scheme og giver 500 her.
        if (item.Voter != voter && !IsAdmin(req)) return Results.StatusCode(StatusCodes.Status403Forbidden);
        set(db).Remove(item);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }).RequireRateLimiting("skriv");

// Afstemninger og holdninger har ét svar pr. læser, så de slettes via spørgsmålets id
// i stedet for rækkens: med ?voter=… fjernes netop det svar (admin eller læseren selv),
// og uden voter rydder X-Admin-Key alle svar på spørgsmålet.
api.MapDelete("/polls/{pollId}", async (string slug, string pollId, string? voter, HttpRequest req, BlogDb db) =>
{
    if (!ValidSlug(slug) || !ValidId(pollId)) return Results.BadRequest();
    var admin = IsAdmin(req);
    // Med ?voter= fjernes kun den ene stemme (admin eller læseren selv); uden voter rydder admin alle.
    if (voter is not null && !ValidVoter(voter)) return Results.BadRequest();
    if (voter is null && !admin) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var query = db.Votes.Where(v => v.Post == slug && v.PollId == pollId);
    if (voter is not null) query = query.Where(v => v.Voter == voter);
    var rows = await query.ToListAsync();
    if (rows.Count == 0) return Results.NotFound();
    db.Votes.RemoveRange(rows);
    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireRateLimiting("skriv");

api.MapDelete("/stances/{stanceId}", async (string slug, string stanceId, string? voter, HttpRequest req, BlogDb db) =>
{
    if (!ValidSlug(slug) || !ValidId(stanceId)) return Results.BadRequest();
    var admin = IsAdmin(req);
    // Med ?voter= fjernes kun det ene svar (admin eller læseren selv); uden voter rydder admin alle.
    if (voter is not null && !ValidVoter(voter)) return Results.BadRequest();
    if (voter is null && !admin) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var query = db.Stances.Where(s => s.Post == slug && s.StanceId == stanceId);
    if (voter is not null) query = query.Where(s => s.Voter == voter);
    var rows = await query.ToListAsync();
    if (rows.Count == 0) return Results.NotFound();
    db.Stances.RemoveRange(rows);
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
        votes = await db.Votes.OrderByDescending(x => x.CreatedAt).Take(100).Select(x => new { x.Id, x.Post, x.PollId, x.Option, x.Voter, x.CreatedAt }).ToListAsync(),
        stances = await db.Stances.OrderByDescending(x => x.CreatedAt).Take(100).Select(x => new { x.Id, x.Post, x.StanceId, x.Value, x.Voter, x.CreatedAt }).ToListAsync(),
    });
});

// Indholdet i databasen. De gamle Markdown-indlæg ligger stadig som statiske sider.
var blog = app.MapGroup("/api/blog");

blog.MapGet("/posts", async (HttpRequest req, BlogDb db) =>
{
    var admin = IsAdmin(req);
    var now = DateTime.UtcNow;
    var query = db.Posts.AsNoTracking();
    if (!admin) query = query.Where(p => p.DeletedAt == null && !p.Draft && p.PublishDate <= now);
    var posts = await query.OrderByDescending(p => p.PublishDate).ToListAsync();
    return Results.Ok(posts.Select(PostSummary));
});

blog.MapGet("/posts/{slug}", async (string slug, HttpRequest req, BlogDb db) =>
{
    if (!ValidSlug(slug)) return Results.NotFound();
    var post = await db.Posts.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug);
    if (post is null || post.DeletedAt != null || (!IsAdmin(req) && (post.Draft || post.PublishDate > DateTime.UtcNow))) return Results.NotFound();
    return Results.Ok(PostDetail(post, true));
});

app.MapGet("/api/admin/blog/posts", async (HttpRequest req, BlogDb db, bool? trash) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var query = db.Posts.AsNoTracking();
    query = trash == true
        ? query.Where(p => p.DeletedAt != null)
        : query.Where(p => p.DeletedAt == null);
    var posts = await query.OrderByDescending(p => p.UpdatedAt ?? p.PublishDate).ToListAsync();
    return Results.Ok(posts.Select(PostSummary));
}).RequireRateLimiting("admin");

app.MapGet("/api/admin/blog/posts/{slug}", async (string slug, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    if (!ValidSlug(slug)) return Results.NotFound();
    var post = await db.Posts.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug);
    return post is null ? Results.NotFound() : Results.Ok(PostDetail(post, true));
});

app.MapPut("/api/admin/blog/posts/{slug}", async (string slug, BlogPostInput input, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    if (!ValidSlug(slug)) return Results.BadRequest("Adressen må kun indeholde a-z, 0-9 og bindestreg.");

    var title = Clean(input.Title, 200);
    if (title.Length == 0) return Results.BadRequest("Indlægget mangler en titel.");
    var bodyMarkdown = input.BodyMarkdown ?? "";
    var bodyHtml = input.BodyHtml ?? "";
    if (bodyHtml.Length > 1_500_000) return Results.BadRequest("Indholdet er for stort.");
    bodyHtml = SanitizeBody(bodyHtml);

    var publishDate = input.PublishDate ?? DateTime.UtcNow;
    if (publishDate.Kind == DateTimeKind.Local) publishDate = publishDate.ToUniversalTime();
    else if (publishDate.Kind == DateTimeKind.Unspecified) publishDate = DateTime.SpecifyKind(publishDate, DateTimeKind.Utc);

    var links = (input.Links ?? [])
        .Select(l => new LinkInput(Clean(l?.Title, 160), (l?.Url ?? "").Trim()))
        .Where(l => l.Title is { Length: > 0 } && Uri.TryCreate(l.Url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        .Take(20)
        .ToList();
    var interactive = input.Interactive ?? new InteractiveInput(true, true, true, true);

    var post = await db.Posts.FirstOrDefaultAsync(p => p.Slug == slug);
    var isNew = post is null;
    if (isNew)
    {
        // En ny databaseadresse må ikke overskygge en eksisterende statisk side.
        // StaticFiles svarer før den dynamiske rute, så et gammelt indlæg ville ellers vinde.
        var webRoot = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
        var candidate = Path.Combine(webRoot, slug);
        string[] reserved = ["api", "admin", "post-shell", "studie", "emner", "sites", "feeds", "media"];
        if (reserved.Contains(slug) || Directory.Exists(candidate) || File.Exists(candidate) || File.Exists(candidate + ".html"))
            return Results.Conflict("Adressen er allerede brugt af en side på bloggen. Vælg en anden.");
    }
    if (post is null)
    {
        post = new BlogPost { Slug = slug, CreatedAt = DateTime.UtcNow };
        db.Posts.Add(post);
    }

    if (!isNew)
    {
        db.Revisions.Add(RevisionFor(post));
    }

    post.Title = title;
    post.Description = Clean(input.Description, 600) is { Length: > 0 } description ? description : null;
    post.BodyMarkdown = bodyMarkdown;
    post.BodyHtml = bodyHtml;
    post.Tldr = Clean(input.Tldr, 1000) is { Length: > 0 } tldr ? tldr : null;
    post.PublishDate = publishDate;
    post.Draft = input.Draft ?? false;
    post.TagsJson = JsonSerializer.Serialize(CleanList(input.Tags, 20, 40));
    post.SitesJson = JsonSerializer.Serialize(CleanList(input.Sites, 20, 40));
    post.LinksJson = JsonSerializer.Serialize(links);
    post.Cover = Clean(input.Cover, 500) is { Length: > 0 } cover ? cover : null;
    post.Video = Clean(input.Video, 500) is { Length: > 0 } video ? video : null;
    post.VideoFormat = input.VideoFormat == "lodret" ? "lodret" : input.VideoFormat == "vandret" ? "vandret" : null;
    post.Font = input.Font is "sans" or "mono" or "haandskrift" ? input.Font : "serif";
    post.Voice = Clean(input.Voice, 500) is { Length: > 0 } voice ? voice : null;
    post.Captions = Clean(input.Captions, 500) is { Length: > 0 } captions ? captions : null;
    post.Archived = input.Archived ?? false;
    post.DeletedAt = null;
    post.ReadingMinutes = input.ReadingMinutes is > 0 and < 1000
        ? input.ReadingMinutes.Value
        : ReadingMinutes(bodyMarkdown, bodyHtml);
    post.InteractiveJson = JsonSerializer.Serialize(new
    {
        comments = interactive.Comments ?? true,
        highlights = interactive.Highlights ?? true,
        graffiti = interactive.Graffiti ?? true,
        readAloud = interactive.ReadAloud ?? true,
    });
    if (!isNew) post.UpdatedAt = DateTime.UtcNow;

    await db.SaveChangesAsync();
    await TrimRevisions(db, slug);
    await Audit(db, "save", "post", slug, title);
    await db.SaveChangesAsync();
    return Results.Ok(PostDetail(post, true));
}).RequireRateLimiting("skriv");

app.MapDelete("/api/admin/blog/posts/{slug}", async (string slug, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var post = await db.Posts.FirstOrDefaultAsync(p => p.Slug == slug);
    if (post is null) return Results.NotFound();

    // Første sletning er en papirkurv. Intet medie eller interaktion fjernes,
    // før indlægget tømmes permanent fra papirkurven.
    post.DeletedAt = DateTime.UtcNow;
    post.UpdatedAt = DateTime.UtcNow;
    await Audit(db, "trash", "post", slug, post.Title);
    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireRateLimiting("skriv");

app.MapPost("/api/admin/blog/posts/{slug}/restore", async (string slug, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var post = await db.Posts.FirstOrDefaultAsync(p => p.Slug == slug);
    if (post is null) return Results.NotFound();
    post.DeletedAt = null;
    post.UpdatedAt = DateTime.UtcNow;
    await Audit(db, "restore", "post", slug, post.Title);
    await db.SaveChangesAsync();
    return Results.Ok(PostDetail(post, true));
}).RequireRateLimiting("skriv");

app.MapDelete("/api/admin/blog/posts/{slug}/purge", async (string slug, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var post = await db.Posts.FirstOrDefaultAsync(p => p.Slug == slug);
    if (post is null) return Results.NotFound();

    var media = await MediaForPost(db, post);
    var comments = await db.Comments.Where(x => x.Post == slug).ToListAsync();
    var annotations = await db.Annotations.Where(x => x.Post == slug).ToListAsync();
    var strokes = await db.Strokes.Where(x => x.Post == slug).ToListAsync();
    var votes = await db.Votes.Where(x => x.Post == slug).ToListAsync();
    var stances = await db.Stances.Where(x => x.Post == slug).ToListAsync();
    var revisions = await db.Revisions.Where(x => x.Slug == slug).ToListAsync();

    db.Comments.RemoveRange(comments);
    db.Annotations.RemoveRange(annotations);
    db.Strokes.RemoveRange(strokes);
    db.Votes.RemoveRange(votes);
    db.Stances.RemoveRange(stances);
    db.Revisions.RemoveRange(revisions);
    db.Media.RemoveRange(media);
    db.Posts.Remove(post);
    await Audit(db, "purge", "post", slug, post.Title);
    await db.SaveChangesAsync();

    // Gamle statiske kopier må ikke genopstå, når databaseindlægget er slettet.
    DeleteStaticFiles(app, post.Slug, media);
    return Results.NoContent();
}).RequireRateLimiting("skriv");

app.MapGet("/api/admin/blog/posts/{slug}/revisions", async (string slug, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var revisions = await db.Revisions.AsNoTracking()
        .Where(r => r.Slug == slug)
        .OrderByDescending(r => r.CreatedAt)
        .Take(30)
        .Select(r => new { r.Id, r.Title, r.CreatedAt, words = r.BodyMarkdown.Length })
        .ToListAsync();
    return Results.Ok(revisions);
}).RequireRateLimiting("admin");

app.MapPost("/api/admin/blog/posts/{slug}/revisions/{id:int}/restore", async (string slug, int id, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var revision = await db.Revisions.FirstOrDefaultAsync(r => r.Id == id && r.Slug == slug);
    var post = await db.Posts.FirstOrDefaultAsync(p => p.Slug == slug);
    if (revision is null || post is null) return Results.NotFound();
    var snapshot = JsonSerializer.Deserialize<BackupPost>(revision.SnapshotJson, JsonDefaults.Web);
    if (snapshot is null) return Results.BadRequest("Versionen kunne ikke læses.");
    db.Revisions.Add(RevisionFor(post));
    ApplyBackupPost(post, snapshot);
    post.DeletedAt = null;
    post.UpdatedAt = DateTime.UtcNow;
    await Audit(db, "revision-restore", "post", slug, $"version {id}");
    await db.SaveChangesAsync();
    return Results.Ok(PostDetail(post, true));
}).RequireRateLimiting("skriv");

app.MapPost("/api/admin/blog/media", async (HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    if (!req.HasFormContentType) return Results.BadRequest("Der mangler en fil.");

    var form = await req.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest("Vælg et billede.");
    if (file.Length > 45_000_000) return Results.BadRequest("Filen må højst være 45 MB.");

    var contentType = MediaContentType(file.ContentType, file.FileName);
    if (contentType is null) return Results.BadRequest("Kun billeder (png, jpeg, webp, gif, avif), video (mp4, webm, mov, m4v) og undertekster (.vtt).");

    using var stream = new MemoryStream();
    await file.CopyToAsync(stream);
    var publicPath = Clean(form["publicPath"], 500);
    if (!publicPath.StartsWith("/media/", StringComparison.Ordinal) || publicPath.Contains("..", StringComparison.Ordinal)) publicPath = "";

    var media = new BlogMedia
    {
        PostSlug = Clean(form["postSlug"], 120) is { Length: > 0 } postSlug ? postSlug : null,
        FileName = Clean(Path.GetFileName(file.FileName), 255) is { Length: > 0 } name ? name : "billede",
        ContentType = contentType,
        PublicPath = publicPath.Length > 0 ? publicPath : null,
        Bytes = stream.ToArray(),
    };
    db.Media.Add(media);
    await db.SaveChangesAsync();
    return Results.Ok(new { media.Id, url = $"/api/blog/media/{media.Id}", name = media.FileName });
}).RequireRateLimiting("skriv");

app.MapGet("/api/admin/blog/media", async (HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var posts = await db.Posts.AsNoTracking().ToListAsync();
    var media = await db.Media.AsNoTracking().OrderByDescending(m => m.CreatedAt).ToListAsync();
    var usage = MediaUsage(posts, media);
    return Results.Ok(media.Select(m => new
    {
        m.Id,
        m.FileName,
        m.ContentType,
        m.PostSlug,
        m.PublicPath,
        size = m.Bytes.Length,
        m.CreatedAt,
        url = m.PublicPath ?? $"/api/blog/media/{m.Id}",
        usedBy = usage.GetValueOrDefault(m.Id, []),
        orphan = !usage.ContainsKey(m.Id),
    }));
}).RequireRateLimiting("admin");

app.MapDelete("/api/admin/blog/media/{id:int}", async (int id, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var media = await db.Media.FirstOrDefaultAsync(m => m.Id == id);
    if (media is null) return Results.NotFound();
    var posts = await db.Posts.AsNoTracking().ToListAsync();
    if (MediaUsage(posts, [media]).ContainsKey(media.Id))
        return Results.Conflict("Mediet bruges af et indlæg. Fjern referencen først.");
    db.Media.Remove(media);
    await Audit(db, "media-delete", "media", id.ToString(), media.FileName);
    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireRateLimiting("skriv");

app.MapPost("/api/admin/blog/media/cleanup", async (HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var posts = await db.Posts.AsNoTracking().ToListAsync();
    var media = await db.Media.ToListAsync();
    var usage = MediaUsage(posts, media);
    var orphans = media.Where(m => !usage.ContainsKey(m.Id)).ToList();
    db.Media.RemoveRange(orphans);
    await Audit(db, "media-cleanup", "media", null, $"{orphans.Count} ubrugte filer");
    await db.SaveChangesAsync();
    return Results.Ok(new { removed = orphans.Count });
}).RequireRateLimiting("skriv");

app.MapGet("/api/blog/media/{id:int}", async (int id, HttpContext ctx, BlogDb db) =>
{
    var media = await db.Media.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id);
    if (media is null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "public, max-age=604800, immutable";
    return Results.File(media.Bytes, media.ContentType, enableRangeProcessing: true);
});

// Nye databaseindlæg får deres egen side. Gamle statiske indlæg bliver stadig
// udleveret af StaticFiles, fordi de har en fil i wwwroot.
app.MapGet("/{slug}", async (string slug, HttpRequest req, BlogDb db) =>
{
    if (!ValidSlug(slug)) return Results.NotFound();
    var post = await db.Posts.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug);
    if (post is null || post.DeletedAt != null || (!IsAdmin(req) && (post.Draft || post.PublishDate > DateTime.UtcNow))) return Results.NotFound();

    var shellPath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "post-shell", "index.html");
    if (!File.Exists(shellPath)) return Results.NotFound();
    var html = await FillPostShell(await File.ReadAllTextAsync(shellPath), post, db);
    return Results.Content(html, "text/html; charset=utf-8");
});

app.MapPost("/api/admin/blog/posts/{slug}/preview-link", async (string slug, HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    if (!ValidSlug(slug) || !await db.Posts.AnyAsync(p => p.Slug == slug)) return Results.NotFound();
    var expires = DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds();
    var token = PreviewToken(slug, expires);
    return Results.Ok(new
    {
        url = $"/preview/{slug}?expires={expires}&token={token}",
        expires = DateTimeOffset.FromUnixTimeSeconds(expires),
    });
}).RequireRateLimiting("admin");

app.MapGet("/preview/{slug}", async (string slug, HttpContext ctx, BlogDb db) =>
{
    var token = ctx.Request.Query["token"].ToString();
    if (string.IsNullOrEmpty(adminKey) || !ValidSlug(slug) || !long.TryParse(ctx.Request.Query["expires"], out var expires) ||
        expires < DateTimeOffset.UtcNow.ToUnixTimeSeconds() || token != PreviewToken(slug, expires))
        return Results.NotFound();
    var post = await db.Posts.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug);
    if (post is null) return Results.NotFound();
    var shellPath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "post-shell", "index.html");
    if (!File.Exists(shellPath)) return Results.NotFound();
    ctx.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    ctx.Response.Headers.CacheControl = "private, no-store";
    var html = await FillPostShell(await File.ReadAllTextAsync(shellPath), post, db);
    return Results.Content(html.Replace("</head>", "<meta name=\"robots\" content=\"noindex, nofollow\"> </head>", StringComparison.OrdinalIgnoreCase), "text/html; charset=utf-8");
});

app.MapGet("/api/admin/backup/export", async (HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var bytes = await BlogBackup.CreateAsync(db);
    return Results.File(bytes, "application/zip", $"blog-backup-{DateTime.UtcNow:yyyyMMdd-HHmm}.zip");
}).RequireRateLimiting("admin");

app.MapPost("/api/admin/backup/restore", async (HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    if (!req.HasFormContentType) return Results.BadRequest("Vælg en backup-zip.");
    var form = await req.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0 || file.Length > 250_000_000) return Results.BadRequest("Vælg en backup-zip på højst 250 MB.");
    await using var stream = file.OpenReadStream();
    var result = await BlogBackup.RestoreAsync(db, stream);
    await Audit(db, "backup-restore", "backup", null, $"{result.PostsAdded} nye, {result.PostsUpdated} opdaterede indlæg");
    await db.SaveChangesAsync();
    return Results.Ok(result);
}).RequireRateLimiting("skriv");

app.MapGet("/api/admin/backup", async (HttpRequest req) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var dir = BackupDirectory(app);
    var files = Directory.Exists(dir)
        ? Directory.EnumerateFiles(dir, "blog-backup-*.zip").OrderByDescending(f => f).Take(20)
            .Select(f => new FileInfo(f)).Select(f => new { name = f.Name, size = f.Length, created = f.CreationTimeUtc })
        : [];
    return Results.Ok(new { directory = dir, files });
}).RequireRateLimiting("admin");

app.MapGet("/api/admin/diagnostics", async (HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    var posts = await db.Posts.AsNoTracking().ToListAsync();
    var media = await db.Media.AsNoTracking().ToListAsync();
    var backupDir = BackupDirectory(app);
    var backups = Directory.Exists(backupDir) ? Directory.EnumerateFiles(backupDir, "blog-backup-*.zip").ToList() : [];
    return Results.Ok(new
    {
        ok = true,
        database = connection.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase) ? "SQLite" : "MySQL",
        adminKeyConfigured = !string.IsNullOrWhiteSpace(adminKey),
        posts = posts.Count,
        published = posts.Count(p => p.DeletedAt == null && !p.Draft && p.PublishDate <= DateTime.UtcNow),
        drafts = posts.Count(p => p.DeletedAt == null && p.Draft),
        trash = posts.Count(p => p.DeletedAt != null),
        mediaCount = media.Count,
        mediaBytes = media.Sum(m => (long)m.Bytes.Length),
        mediaOrphans = media.Count - MediaUsage(posts, media).Count,
        backupCount = backups.Count,
        latestBackup = backups.OrderByDescending(f => f).FirstOrDefault() is { } latest ? new FileInfo(latest).Name : null,
        maxUploadMb = 45,
        serverUtc = DateTime.UtcNow,
    });
}).RequireRateLimiting("admin");

app.MapGet("/api/admin/audit", async (HttpRequest req, BlogDb db) =>
{
    if (!IsAdmin(req)) return Results.Unauthorized();
    return Results.Ok(await db.Audit.AsNoTracking().OrderByDescending(a => a.CreatedAt).Take(100).ToListAsync());
}).RequireRateLimiting("admin");

app.MapGet("/api/health", async (BlogDb db) => Results.Ok(new
{
    ok = true,
    utc = DateTime.UtcNow,
    posts = await db.Posts.CountAsync(p => p.DeletedAt == null),
    media = await db.Media.CountAsync(),
}));

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

bool IsAdmin(HttpRequest req)
{
    if (string.IsNullOrEmpty(adminKey)) return false;
    var provided = req.Headers["X-Admin-Key"].ToString();
    if (provided.Length != adminKey.Length) return false;
    return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(adminKey));
}

// Et indlæg er gyldigt, hvis det er en gammel statisk side eller et publiceret
// indlæg i databasen. Kladder og fremtidige indlæg kan først kommenteres, når de er ude.
async Task<bool> ValidPostAsync(string slug, BlogDb db) =>
    ValidSlug(slug) &&
    (app.Environment.IsDevelopment() ||
     app.Environment.WebRootFileProvider.GetFileInfo($"{slug}/index.html").Exists ||
     await db.Posts.AnyAsync(p => p.Slug == slug && p.DeletedAt == null && !p.Draft && p.PublishDate <= DateTime.UtcNow));

// Bruges før static files, så gamle /<slug>/index.html ikke skygger for
// det importerede databaseindlæg med samme adresse.
async Task<bool> TryServePostAsync(HttpContext ctx, BlogDb db)
{
    var slug = (ctx.Request.Path.Value ?? "").Trim('/');
    if (!ValidSlug(slug)) return false;

    var post = await db.Posts.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug);
    if (post is null) return false;

    if (post.DeletedAt != null || (!IsAdmin(ctx.Request) && (post.Draft || post.PublishDate > DateTime.UtcNow)))
    {
        // Indlægget findes i databasen, men er ikke publiceret. Så må en gammel
        // statisk side med samme slug ikke blive ved med at lække indholdet.
        ctx.Response.StatusCode = 404;
        var notFound = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "404.html");
        if (File.Exists(notFound))
        {
            ctx.Response.ContentType = "text/html; charset=utf-8";
            await ctx.Response.SendFileAsync(notFound);
        }
        return true;
    }

    var shellPath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "post-shell", "index.html");
    if (!File.Exists(shellPath)) return false;

    var html = await FillPostShell(await File.ReadAllTextAsync(shellPath), post, db);
    ctx.Response.ContentType = "text/html; charset=utf-8";
    await ctx.Response.WriteAsync(html);
    return true;
}

static bool TryRange(string header, int total, out long start, out long end)
{
    start = 0;
    end = total - 1;
    if (total <= 0 || !header.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase)) return false;

    var spec = header[6..].Trim();
    if (spec.Contains(',')) return false; // flere ranges sendes som hele filen
    var dash = spec.IndexOf('-');
    if (dash < 0) return false;

    var from = spec[..dash].Trim();
    var to = spec[(dash + 1)..].Trim();
    if (from.Length == 0)
    {
        if (!long.TryParse(to, NumberStyles.None, CultureInfo.InvariantCulture, out var suffix) || suffix <= 0) return false;
        start = Math.Max(0, total - suffix);
    }
    else if (!long.TryParse(from, NumberStyles.None, CultureInfo.InvariantCulture, out start) || start < 0 || start >= total)
    {
        return false;
    }

    if (to.Length > 0 && long.TryParse(to, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedEnd))
        end = Math.Min(parsedEnd, total - 1L);
    return end >= start;
}

static bool ValidSlug(string slug) => Regex.IsMatch(slug, "^[a-z0-9-]{1,120}$");
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

static object PostSummary(BlogPost p) => new
{
    p.Slug,
    p.Title,
    p.Description,
    publishDate = p.PublishDate,
    updated = p.UpdatedAt,
    p.Draft,
    tags = ParseList(p.TagsJson),
    sites = ParseList(p.SitesJson),
    p.Cover,
    p.ReadingMinutes,
    p.Archived,
    deletedAt = p.DeletedAt,
    status = PostStatus(p),
};

static object PostDetail(BlogPost p, bool includeBody) => new
{
    p.Slug,
    p.Title,
    p.Description,
    p.Tldr,
    bodyMarkdown = includeBody ? p.BodyMarkdown : null,
    bodyHtml = includeBody ? p.BodyHtml : null,
    publishDate = p.PublishDate,
    updated = p.UpdatedAt,
    p.Draft,
    tags = ParseList(p.TagsJson),
    sites = ParseList(p.SitesJson),
    links = ParseLinks(p.LinksJson),
    p.Cover,
    p.Video,
    p.VideoFormat,
    p.Font,
    p.Voice,
    p.Captions,
    p.Archived,
    deletedAt = p.DeletedAt,
    status = PostStatus(p),
    p.ReadingMinutes,
    interactive = ParseInteractive(p.InteractiveJson),
};

static string PostStatus(BlogPost p) =>
    p.DeletedAt is not null ? "slettet" :
    p.Draft ? "kladde" :
    p.PublishDate > DateTime.UtcNow ? "planlagt" : "live";

static string[] ParseList(string json)
{
    try { return JsonSerializer.Deserialize<string[]>(json, JsonDefaults.Web) ?? []; }
    catch { return []; }
}

static List<LinkInput> ParseLinks(string json)
{
    try { return JsonSerializer.Deserialize<List<LinkInput>>(json, JsonDefaults.Web) ?? []; }
    catch { return []; }
}

static InteractiveInput ParseInteractive(string json)
{
    try { return JsonSerializer.Deserialize<InteractiveInput>(json, JsonDefaults.Web) ?? new(true, true, true, true); }
    catch { return new(true, true, true, true); }
}


static string[] CleanList(IEnumerable<string>? values, int maxItems, int maxLength) =>
    (values ?? [])
        .Select(v => Clean(v, maxLength))
        .Where(v => v.Length > 0)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Take(maxItems)
        .ToArray();

static string SanitizeBody(string html)
{
    html = Regex.Replace(html, @"<\s*(script|style|link|meta|base|form|object|embed)\b[^>]*>.*?<\s*/\s*\1\s*>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
    html = Regex.Replace(html, @"<\s*(script|style|link|meta|base|form|object|embed)\b[^>]*/?>", "", RegexOptions.IgnoreCase);
    html = Regex.Replace(html, @"\son\w+\s*=\s*(""[^""]*""|'[^']*'|[^\s>]+)", "", RegexOptions.IgnoreCase);
    html = Regex.Replace(html, @"\s(?:srcdoc|formaction)\s*=\s*(""[^""]*""|'[^']*'|[^\s>]+)", "", RegexOptions.IgnoreCase);
    html = Regex.Replace(html, @"\sstyle\s*=\s*(""[^""]*(?:expression|javascript|vbscript)\s*:[^""]*""|'[^']*(?:expression|javascript|vbscript)\s*:[^']*')", "", RegexOptions.IgnoreCase);
    html = Regex.Replace(html, @"(href|src)\s*=\s*(""|')\s*(?:javascript|vbscript|data:text/html)\s*:[^""']*\2", "$1=\"#\"", RegexOptions.IgnoreCase);
    return html.Trim();
}

static string? MediaContentType(string? contentType, string fileName)
{
    var allowed = new[]
    {
        "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif",
        "video/mp4", "video/webm", "video/quicktime", "video/x-m4v",
        "text/vtt",
    };
    var type = (contentType ?? "").Split(';')[0].Trim().ToLowerInvariant();
    if (allowed.Contains(type)) return type;
    return Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".avif" => "image/avif",
        ".mp4" => "video/mp4",
        ".webm" => "video/webm",
        ".mov" => "video/quicktime",
        ".m4v" => "video/x-m4v",
        ".vtt" => "text/vtt",
        _ => null,
    };
}

// Find de medier, der hører til indlægget: uploads med postSlug samt gamle
// /media/-billeder, som kun dette indlæg refererer til. Delte billeder bevares.
static async Task<List<BlogMedia>> MediaForPost(BlogDb db, BlogPost post)
{
    var media = await db.Media.Where(m => m.PostSlug == post.Slug).ToListAsync();
    var own = Unescape(string.Join('\n', new[] { post.Cover, post.Video, post.Voice, post.Captions, post.BodyMarkdown, post.BodyHtml }
        .Where(value => !string.IsNullOrWhiteSpace(value))));
    if (own.Length == 0) return media;

    var others = await db.Posts.AsNoTracking()
        .Where(p => p.Slug != post.Slug)
        .Select(p => new { p.Cover, p.BodyMarkdown, p.BodyHtml })
        .ToListAsync();
    var otherText = Unescape(string.Join('\n', others
        .SelectMany(p => new[] { p.Cover, p.BodyMarkdown, p.BodyHtml })
        .Where(value => !string.IsNullOrWhiteSpace(value))));

    foreach (var candidate in await db.Media.Where(m => m.PublicPath != null).ToListAsync())
    {
        var path = candidate.PublicPath!;
        if (media.Any(m => m.Id == candidate.Id)) continue;
        if (!own.Contains(path, StringComparison.Ordinal)) continue;
        if (otherText.Contains(path, StringComparison.Ordinal)) continue;
        media.Add(candidate);
    }
    return media;
}

static string Unescape(string value)
{
    try { return Uri.UnescapeDataString(value); }
    catch { return value; }
}

// Fjerner gamle statiske kopier, så en slettet databasepost ikke genopstår fra
// en tidligere upload. Kun filer under wwwroot og den konkrete slug røres.
static void DeleteStaticFiles(WebApplication app, string slug, IEnumerable<BlogMedia> media)
{
    var root = Path.GetFullPath(app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot"));
    if (!Directory.Exists(root)) return;

    var postDir = Path.GetFullPath(Path.Combine(root, slug));
    if (IsUnder(root, postDir) && Directory.Exists(postDir))
    {
        try
        {
            var index = Path.Combine(postDir, "index.html");
            if (File.Exists(index)) File.Delete(index);
            if (!Directory.EnumerateFileSystemEntries(postDir).Any()) Directory.Delete(postDir);
        }
        catch { }
    }

    foreach (var path in media.Select(m => m.PublicPath).Where(p => !string.IsNullOrWhiteSpace(p)).Distinct())
    {
        var file = Path.GetFullPath(Path.Combine(root, path!.TrimStart('/')));
        if (!IsUnder(root, file) || !File.Exists(file)) continue;
        try { File.Delete(file); }
        catch { }
    }
}

static bool IsUnder(string root, string path) =>
    path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal);

static int ReadingMinutes(string markdown, string html)
{
    var text = string.IsNullOrWhiteSpace(markdown) ? Regex.Replace(html, "<[^>]+>", " ") : markdown;
    var words = Regex.Split(text, @"\s+").Count(part => part.Length > 0);
    return Math.Max(1, (int)Math.Round(words / 200.0));
}

static string TagSlug(string value) =>
    Regex.Replace(value.ToLowerInvariant().Replace("æ", "ae").Replace("ø", "oe").Replace("å", "aa"), @"[^a-z0-9]+", "-").Trim('-');

static string Html(string? value) => WebUtility.HtmlEncode(value ?? "");

static async Task<List<BlogPost>> PublishedPosts(BlogDb db)
{
    var now = DateTime.UtcNow;
    return await db.Posts.AsNoTracking()
        .Where(p => p.DeletedAt == null && !p.Draft && p.PublishDate <= now)
        .OrderByDescending(p => p.PublishDate)
        .ToListAsync();
}

static string RenderPostRows(IEnumerable<BlogPost> posts, string emptyText)
{
    var list = posts.ToList();
    if (list.Count == 0) return $"<p class=\"empty-state\">{Html(emptyText)}</p>";

    var sb = new StringBuilder("<ol class=\"post-list\">");
    for (var i = 0; i < list.Count; i++)
    {
        var p = list[i];
        sb.Append("<li class=\"post-row\"><span class=\"post-index\" aria-hidden=\"true\">");
        sb.Append((i + 1).ToString("00"));
        sb.Append("</span><div class=\"post-main\"><div class=\"meta\">");
        sb.Append(RenderDate(p.PublishDate));
        sb.Append("<span>");
        sb.Append(p.ReadingMinutes);
        sb.Append(" min. læsning</span>");
        if (p.Archived) sb.Append("<span class=\"badge\">Arkiv</span>");
        sb.Append("</div><h2><a href=\"/");
        sb.Append(Html(p.Slug));
        sb.Append("/\">");
        sb.Append(Html(p.Title));
        sb.Append("</a></h2>");
        if (!string.IsNullOrWhiteSpace(p.Description)) sb.Append("<p>").Append(Html(p.Description)).Append("</p>");
        sb.Append(RenderTags(p));
        sb.Append("</div><span class=\"post-arrow\" aria-hidden=\"true\">↗</span></li>");
    }
    sb.Append("</ol>");
    return sb.ToString();
}

static string RenderHomePosts(IEnumerable<BlogPost> posts)
{
    var list = posts.ToList();
    if (list.Count == 0) return "<p class=\"empty-state\">Der er ingen indlæg endnu.</p>";

    var featured = list.FirstOrDefault(p => !p.Archived) ?? list[0];
    var rest = list.Where(p => p.Slug != featured.Slug).ToList();
    var sb = new StringBuilder();

    sb.Append("<a class=\"featured\" href=\"/").Append(Html(featured.Slug)).Append("/\">");
    sb.Append("<div class=\"featured-body\"><p class=\"eyebrow\">Seneste</p><div class=\"meta\">");
    sb.Append(RenderDate(featured.PublishDate));
    sb.Append("<span>").Append(featured.ReadingMinutes).Append(" min. læsning</span></div>");
    sb.Append("<h2>").Append(Html(featured.Title)).Append("</h2>");
    if (!string.IsNullOrWhiteSpace(featured.Description)) sb.Append("<p>").Append(Html(featured.Description)).Append("</p>");
    sb.Append("<span class=\"featured-cta\">Læs teksten <span aria-hidden=\"true\">→</span></span></div>");
    sb.Append("<div class=\"featured-art\" aria-hidden=\"true\">");
    if (!string.IsNullOrWhiteSpace(featured.Cover)) sb.Append("<img src=\"").Append(Html(featured.Cover)).Append("\" alt=\"\" loading=\"eager\" />");
    else sb.Append("<span class=\"featured-number\">01</span>");
    sb.Append("</div></a>");

    sb.Append("<section class=\"section db-posts\" id=\"alle-indlaeg\"><div class=\"section-head\"><h2>Alle indlæg</h2><span>");
    sb.Append(list.Count).Append(list.Count == 1 ? " tekst" : " tekster").Append("</span></div>");
    sb.Append(RenderPostRows(rest, "Der er ikke flere indlæg endnu."));
    sb.Append("</section>");
    return sb.ToString();
}

static string RenderTopics(IEnumerable<BlogPost> posts)
{
    var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    foreach (var post in posts)
    {
        foreach (var tag in ParseList(post.TagsJson))
        {
            var slug = TagSlug(tag);
            if (slug.Length == 0) continue;
            counts[slug] = counts.GetValueOrDefault(slug) + 1;
            names.TryAdd(slug, tag);
        }
    }

    if (counts.Count == 0) return "<p class=\"empty-state\">Ingen emner endnu.</p>";

    var sb = new StringBuilder("<ul class=\"topic-cloud topic-cloud-large\">");
    foreach (var (slug, count) in counts.OrderByDescending(kv => kv.Value).ThenBy(kv => names[kv.Key], StringComparer.Create(CultureInfo.GetCultureInfo("da-DK"), true)))
    {
        sb.Append("<li><a href=\"/emner/").Append(Html(slug)).Append("/\">").Append(Html(names[slug]));
        sb.Append("<span class=\"count\">").Append(count).Append("</span></a></li>");
    }
    sb.Append("</ul>");
    return sb.ToString();
}

static string? TopicName(IEnumerable<BlogPost> posts, string slug)
{
    foreach (var post in posts)
        foreach (var tag in ParseList(post.TagsJson))
            if (TagSlug(tag) == slug) return tag;
    return null;
}

static string FillTopicShell(string html, string name, string slug)
{
    var url = $"https://blog.villadsclaes.dk/emner/{slug}/";
    return html
        .Replace("__TOPIC_NAME__", Html(name), StringComparison.Ordinal)
        .Replace("https://blog.villadsclaes.dk/emner/topic-shell/", url, StringComparison.Ordinal)
        .Replace("<meta name=\"robots\" content=\"noindex, nofollow\">", "", StringComparison.Ordinal);
}

static string FillSiteShell(string html, string key)
{
    var url = $"https://blog.villadsclaes.dk/sites/{key}/";
    return html
        .Replace("__SITE_NAME__", Html(key), StringComparison.Ordinal)
        .Replace("https://blog.villadsclaes.dk/sites/site-shell/", url, StringComparison.Ordinal)
        .Replace("<meta name=\"robots\" content=\"noindex, nofollow\">", "", StringComparison.Ordinal);
}

static string RenderExtraSites(IEnumerable<KeyValuePair<string, int>> sites)
{
    var list = sites.ToList();
    if (list.Count == 0) return "";

    var sb = new StringBuilder("<div class=\"site-grid\">");
    foreach (var (key, count) in list)
    {
        sb.Append("<a class=\"site-card\" href=\"/sites/").Append(Html(key)).Append("/\">");
        sb.Append("<span class=\"site-kicker\"><span data-site-count=\"").Append(Html(key)).Append("\">").Append(count).Append("</span> indlæg</span>");
        sb.Append("<h2>").Append(Html(key)).Append("</h2>");
        sb.Append("<p>Indlæg på bloggen, der hører til dette site.</p>");
        sb.Append("<span class=\"site-url\">Se indlæggene <span aria-hidden=\"true\">↗</span></span></a>");
    }
    sb.Append("</div>");
    return sb.ToString();
}

static Dictionary<string, int> SiteCounts(IEnumerable<BlogPost> posts)
{
    var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    foreach (var post in posts)
        foreach (var site in ParseList(post.SitesJson))
            counts[site] = counts.GetValueOrDefault(site) + 1;
    return counts;
}

static async Task WriteSitemap(HttpContext ctx, BlogDb db)
{
    var posts = await PublishedPosts(db);
    var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");

    void AddUrl(string loc, DateTime? lastmod = null)
    {
        sb.Append("<url><loc>").Append(Xml(loc)).Append("</loc>");
        if (lastmod is { } date)
            sb.Append("<lastmod>").Append(date.ToUniversalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append("</lastmod>");
        sb.Append("</url>");
    }

    AddUrl("https://blog.villadsclaes.dk/");
    AddUrl("https://blog.villadsclaes.dk/emner/");
    AddUrl("https://blog.villadsclaes.dk/sites/");

    foreach (var post in posts)
        AddUrl($"https://blog.villadsclaes.dk/{post.Slug}/", post.UpdatedAt ?? post.PublishDate);

    var topics = posts
        .SelectMany(p => ParseList(p.TagsJson))
        .Select(TagSlug)
        .Where(slug => slug.Length > 0)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .OrderBy(slug => slug, StringComparer.OrdinalIgnoreCase);
    foreach (var topic in topics)
        AddUrl($"https://blog.villadsclaes.dk/emner/{topic}/");

    var siteKeys = BlogSites.Keys
        .Concat(SiteCounts(posts).Keys)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .OrderBy(key => key, StringComparer.OrdinalIgnoreCase);
    foreach (var site in siteKeys)
        AddUrl($"https://blog.villadsclaes.dk/sites/{site}/");

    sb.Append("</urlset>");
    ctx.Response.ContentType = "application/xml; charset=utf-8";
    ctx.Response.Headers.CacheControl = "public, max-age=300";
    await ctx.Response.WriteAsync(sb.ToString());
}

static async Task WriteSitemapIndex(HttpContext ctx, BlogDb db)
{
    var posts = await PublishedPosts(db);
    var last = posts.Select(p => p.UpdatedAt ?? p.PublishDate).DefaultIfEmpty().Max();
    var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?><sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    sb.Append("<sitemap><loc>https://blog.villadsclaes.dk/sitemap.xml</loc>");
    if (last != default)
        sb.Append("<lastmod>").Append(last.ToUniversalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append("</lastmod>");
    sb.Append("</sitemap></sitemapindex>");
    ctx.Response.ContentType = "application/xml; charset=utf-8";
    ctx.Response.Headers.CacheControl = "public, max-age=300";
    await ctx.Response.WriteAsync(sb.ToString());
}


static string ReplaceSiteCounts(string html, IReadOnlyDictionary<string, int> counts) =>
    Regex.Replace(html, "data-site-count=\"([a-z0-9-]+)\">\\d+</span>", match =>
    {
        var key = match.Groups[1].Value;
        return $"data-site-count=\"{key}\">{counts.GetValueOrDefault(key)}</span>";
    }, RegexOptions.IgnoreCase);

static async Task WriteRss(HttpContext ctx, BlogDb db)
{
    var posts = await PublishedPosts(db);
    var sb = new StringBuilder();
    sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss version=\"2.0\"><channel>");
    sb.Append("<title>Villads Claes · blog</title><link>https://blog.villadsclaes.dk/</link>");
    sb.Append("<description>Tanker, der må tegnes på.</description><language>da-dk</language>");
    foreach (var post in posts)
    {
        var url = $"https://blog.villadsclaes.dk/{post.Slug}/";
        sb.Append("<item><title>").Append(Xml(post.Title)).Append("</title>");
        sb.Append("<link>").Append(url).Append("</link><guid>").Append(url).Append("</guid>");
        sb.Append("<pubDate>").Append(post.PublishDate.ToString("R", CultureInfo.InvariantCulture)).Append("</pubDate>");
        if (!string.IsNullOrWhiteSpace(post.Description)) sb.Append("<description>").Append(Xml(post.Description)).Append("</description>");
        foreach (var tag in ParseList(post.TagsJson)) sb.Append("<category>").Append(Xml(tag)).Append("</category>");
        sb.Append("</item>");
    }
    sb.Append("</channel></rss>");
    ctx.Response.ContentType = "application/rss+xml; charset=utf-8";
    await ctx.Response.WriteAsync(sb.ToString());
}

static async Task WriteFeed(HttpContext ctx, BlogDb db, string key)
{
    var posts = await PublishedPosts(db);
    var items = posts
        .Where(p => key == "alle" || ParseList(p.SitesJson).Contains(key, StringComparer.OrdinalIgnoreCase))
        .Select(p => new
        {
            id = p.Slug,
            url = $"https://blog.villadsclaes.dk/{p.Slug}/",
            title = p.Title,
            summary = p.Description ?? "",
            date_published = p.PublishDate.ToString("O", CultureInfo.InvariantCulture),
            tags = ParseList(p.TagsJson),
        });
    var payload = new
    {
        version = "https://jsonfeed.org/version/1.1",
        title = "Villads Claes · blog",
        home_page_url = "https://blog.villadsclaes.dk/",
        items,
    };
    ctx.Response.ContentType = "application/feed+json; charset=utf-8";
    await ctx.Response.WriteAsync(JsonSerializer.Serialize(payload, JsonDefaults.Web));
}

static string Xml(string? value) => WebUtility.HtmlEncode(value ?? "");

static string RenderDate(DateTime date)
{
    var da = CultureInfo.GetCultureInfo("da-DK");
    return $"<time datetime=\"{date.ToString("O", CultureInfo.InvariantCulture)}\">{date.ToLocalTime().ToString("d. MMMM yyyy", da)}</time>";
}

static string RenderTags(BlogPost post)
{
    var tags = ParseList(post.TagsJson);
    if (tags.Length == 0) return "";
    var sb = new StringBuilder("<div class=\"post-foot\"><ul class=\"tags\">");
    foreach (var tag in tags)
        sb.Append("<li><a href=\"/emner/").Append(Html(TagSlug(tag))).Append("/\">").Append(Html(tag)).Append("</a></li>");
    sb.Append("</ul></div>");
    return sb.ToString();
}

static string RenderMeta(BlogPost post)
{
    var sb = new StringBuilder();
    sb.Append(RenderDate(post.PublishDate));
    sb.Append("<span>").Append(post.ReadingMinutes).Append(" min. læsning</span>");
    if (post.UpdatedAt is { } updated)
    {
        var da = CultureInfo.GetCultureInfo("da-DK");
        sb.Append("<span>Opdateret ").Append(updated.ToLocalTime().ToString("d. MMMM yyyy", da)).Append("</span>");
    }
    if (post.Archived) sb.Append("<span class=\"badge\">Fra arkivet</span>");
    return sb.ToString();
}

static string RenderComments(BlogPost post)
{
    var flags = ParseInteractive(post.InteractiveJson);
    if (!(flags.Comments ?? true)) return "";
    return "<section class=\"x-comments sans\" id=\"besyv\"><h2>Dit besyv</h2><ol class=\"x-comment-list\"></ol><form class=\"x-comment-form\"><label>Navn <input name=\"name\" maxlength=\"60\" autocomplete=\"name\" required /></label><label>Hvad tænker du? <textarea name=\"body\" rows=\"4\" maxlength=\"4000\" required></textarea></label><label class=\"visually-hidden\" aria-hidden=\"true\">Lad være tom <input name=\"website\" tabindex=\"-1\" autocomplete=\"off\" /></label><button type=\"submit\">Send dit besyv</button><p class=\"x-form-status\" role=\"status\"></p></form></section>";
}

static string RenderVideo(string? src, string? format, string? captions = null)
{
    if (string.IsNullOrWhiteSpace(src)) return "";
    var encoded = Html(src);
    var vertical = format == "lodret";
    string content;
    var youtube = Regex.Match(src, @"(?:youtu\.be/|youtube\.com/(?:watch\?v=|shorts/|embed/))([\w-]{6,})");
    var vimeo = Regex.Match(src, @"vimeo\.com/(\d+)");
    if (youtube.Success)
        content = $"<iframe src=\"https://www.youtube-nocookie.com/embed/{youtube.Groups[1].Value}\" title=\"Video\" loading=\"lazy\" allow=\"accelerometer; encrypted-media; picture-in-picture; fullscreen\" allowfullscreen></iframe>";
    else if (vimeo.Success)
        content = $"<iframe src=\"https://player.vimeo.com/video/{vimeo.Groups[1].Value}?dnt=1\" title=\"Video\" loading=\"lazy\" allow=\"fullscreen; picture-in-picture\" allowfullscreen></iframe>";
    else if (Regex.IsMatch(src, @"\.(mp4|webm|mov|m4v)(\?|$)", RegexOptions.IgnoreCase))
        content = $"<video src=\"{encoded}\" controls preload=\"metadata\" playsinline{(!string.IsNullOrWhiteSpace(captions) ? $" crossorigin=\"anonymous\"" : "")}>{(string.IsNullOrWhiteSpace(captions) ? "" : $"<track kind=\"captions\" src=\"{Html(captions)}\" srclang=\"da\" label=\"Dansk\" default />")}</video>";
    else
        content = $"<iframe src=\"{encoded}\" title=\"Indlejret indhold\" loading=\"lazy\" allowfullscreen></iframe>";
    return $"<div class=\"prose\"><figure class=\"x-video{(vertical ? " is-vertical" : "")}\"><div class=\"x-video-frame\">{content}</div></figure></div>";
}

static async Task<string> RenderNav(BlogPost post, BlogDb db)
{
    var posts = await db.Posts.AsNoTracking()
        .Where(p => p.DeletedAt == null && !p.Draft && p.PublishDate <= DateTime.UtcNow)
        .OrderByDescending(p => p.PublishDate)
        .Select(p => new NavPost(p.Slug, p.Title, p.PublishDate))
        .ToListAsync();
    var index = posts.FindIndex(p => p.Slug == post.Slug);
    var newer = index > 0 ? posts[index - 1] : null;
    var older = index >= 0 && index < posts.Count - 1 ? posts[index + 1] : null;
    if (newer is null && older is null) return "";

    var sb = new StringBuilder("<nav class=\"post-nav\" aria-label=\"Flere indlæg\">");
    if (older is not null)
        sb.Append("<a class=\"post-nav-item\" href=\"/").Append(Html(older.Slug)).Append("/\"><span>← Ældre</span><strong>").Append(Html(older.Title)).Append("</strong></a>");
    if (newer is not null)
        sb.Append("<a class=\"post-nav-item post-nav-next\" href=\"/").Append(Html(newer.Slug)).Append("/\"><span>Nyere →</span><strong>").Append(Html(newer.Title)).Append("</strong></a>");
    sb.Append("</nav>");
    return sb.ToString();
}

static string RenderRelated(BlogPost post)
{
    var sites = ParseList(post.SitesJson);
    var links = ParseLinks(post.LinksJson);
    if (sites.Length == 0 && links.Count == 0) return "";
    var sb = new StringBuilder("<aside class=\"related\"><h2>Hører sammen med</h2><ul>");
    foreach (var site in sites)
        sb.Append("<li><a href=\"/sites/").Append(Html(TagSlug(site))).Append("/\">").Append(Html(site)).Append("</a></li>");
    foreach (var link in links)
        sb.Append("<li><a href=\"").Append(Html(link.Url)).Append("\">").Append(Html(link.Title)).Append("</a></li>");
    sb.Append("</ul></aside>");
    return sb.ToString();
}

static async Task<string> FillPostShell(string html, BlogPost post, BlogDb db)
{
    var flags = ParseInteractive(post.InteractiveJson);
    var features = string.Join(' ', new[]
    {
        (flags.Comments ?? true) ? "comments" : "",
        (flags.Highlights ?? true) ? "highlights" : "",
        (flags.Graffiti ?? true) ? "graffiti" : "",
        (flags.ReadAloud ?? true) ? "readAloud" : "",
    }.Where(value => value.Length > 0));
    var tags = ParseList(post.TagsJson);
    var tagHtml = tags.Length == 0
        ? ""
        : "<ul class=\"tags\">" + string.Join("", tags.Select(tag => $"<li><a href=\"/emner/{Html(TagSlug(tag))}/\">{Html(tag)}</a></li>")) + "</ul>";
    var lede = string.IsNullOrWhiteSpace(post.Description) ? "" : $"<p class=\"lede\">{Html(post.Description)}</p>";
    var cover = string.IsNullOrWhiteSpace(post.Cover)
        ? ""
        : $"<figure class=\"post-cover\"><img src=\"{Html(post.Cover)}\" alt=\"\" loading=\"eager\" decoding=\"async\" fetchpriority=\"high\" /></figure>";
    var tldr = string.IsNullOrWhiteSpace(post.Tldr)
        ? ""
        : $"<aside class=\"x-tldr\"><p class=\"x-tldr-title\">TLDR</p><p>{Html(post.Tldr)}</p></aside>";
    var voice = string.IsNullOrWhiteSpace(post.Voice)
        ? ""
        : $"<figure class=\"x-voice sans\"><figcaption>Lyt med min stemme</figcaption><audio id=\"post-voice\" controls preload=\"metadata\" src=\"{Html(post.Voice)}\"></audio></figure>";

    html = html
        .Replace("__TITLE__", Html(post.Title), StringComparison.Ordinal)
        .Replace("__DESCRIPTION__", Html(post.Description ?? ""), StringComparison.Ordinal)
        .Replace("__CANONICAL__", Html($"https://blog.villadsclaes.dk/{post.Slug}/"), StringComparison.Ordinal)
        .Replace("__SLUG__", Html(post.Slug), StringComparison.Ordinal)
        .Replace("__FEATURES__", features, StringComparison.Ordinal)
        .Replace("__FONT__", Html(post.Font), StringComparison.Ordinal)
        .Replace("__META__", RenderMeta(post), StringComparison.Ordinal)
        .Replace("__LEDE__", lede, StringComparison.Ordinal)
        .Replace("__TAGS__", tagHtml, StringComparison.Ordinal)
        .Replace("__COVER__", cover, StringComparison.Ordinal)
        .Replace("__TLDR__", tldr, StringComparison.Ordinal)
        .Replace("__VOICE__", voice, StringComparison.Ordinal)
        .Replace("__VIDEO__", RenderVideo(post.Video, post.VideoFormat, post.Captions), StringComparison.Ordinal)
        .Replace("__BODY__", post.BodyHtml, StringComparison.Ordinal)
        .Replace("__RELATED__", RenderRelated(post), StringComparison.Ordinal)
        .Replace("__COMMENTS__", RenderComments(post), StringComparison.Ordinal)
        .Replace("__NAV__", await RenderNav(post, db), StringComparison.Ordinal)
        .Replace("<meta name=\"robots\" content=\"noindex, nofollow\">", "", StringComparison.Ordinal);
    return html;
}

string PreviewToken(string slug, long expires)
{
    if (string.IsNullOrEmpty(adminKey)) return "";
    using var hmac = new System.Security.Cryptography.HMACSHA256(Encoding.UTF8.GetBytes(adminKey));
    var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{slug}:{expires}"));
    return Convert.ToHexString(hash).ToLowerInvariant();
}

string BackupDirectory(WebApplication app) =>
    app.Configuration["Backup:Directory"] is { Length: > 0 } configured
        ? configured
        : Path.Combine(AppContext.BaseDirectory, "Backups");

static async Task Audit(BlogDb db, string action, string entity, string? entityId, string? detail)
{
    db.Audit.Add(new AuditEntry
    {
        Action = Truncate(action, 40),
        Entity = Truncate(entity, 40),
        EntityId = entityId is null ? null : Truncate(entityId, 120),
        Detail = detail is null ? null : Truncate(detail, 1000),
        CreatedAt = DateTime.UtcNow,
    });
}

static BlogPostRevision RevisionFor(BlogPost post) => new()
{
    Slug = post.Slug,
    Title = post.Title,
    BodyMarkdown = post.BodyMarkdown,
    BodyHtml = post.BodyHtml,
    SnapshotJson = JsonSerializer.Serialize(BackupPost.From(post), JsonDefaults.Web),
    CreatedAt = DateTime.UtcNow,
};

static async Task TrimRevisions(BlogDb db, string slug)
{
    var old = await db.Revisions
        .Where(r => r.Slug == slug)
        .OrderByDescending(r => r.CreatedAt)
        .Skip(30)
        .ToListAsync();
    if (old.Count > 0) db.Revisions.RemoveRange(old);
}

static void ApplyBackupPost(BlogPost post, BackupPost source)
{
    post.Title = Clean(source.Title, 200) is { Length: > 0 } title ? title : post.Title;
    post.Description = Clean(source.Description, 600) is { Length: > 0 } description ? description : null;
    post.BodyMarkdown = source.BodyMarkdown ?? "";
    post.BodyHtml = source.BodyHtml ?? "";
    post.Tldr = Clean(source.Tldr, 1000) is { Length: > 0 } tldr ? tldr : null;
    post.PublishDate = source.PublishDate;
    post.UpdatedAt = source.UpdatedAt;
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
    post.ReadingMinutes = source.ReadingMinutes is > 0 and < 1000 ? source.ReadingMinutes : 1;
    post.InteractiveJson = source.InteractiveJson ?? post.InteractiveJson;
}

static Dictionary<int, List<string>> MediaUsage(IEnumerable<BlogPost> posts, IEnumerable<BlogMedia> media)
{
    var usage = new Dictionary<int, List<string>>();
    foreach (var item in media)
    {
        var refs = new List<string>();
        foreach (var post in posts)
        {
            var candidates = new[] { post.Cover, post.Video, post.Voice, post.Captions, post.BodyMarkdown, post.BodyHtml }
                .Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v!);
            var apiPath = $"/api/blog/media/{item.Id}";
            if (candidates.Any(v => v.Contains(apiPath, StringComparison.Ordinal) ||
                (item.PublicPath is { Length: > 0 } publicPath && v.Contains(publicPath, StringComparison.Ordinal))))
                refs.Add(post.Slug);
        }
        if (refs.Count > 0) usage[item.Id] = refs.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }
    return usage;
}

// Engangsflytning af de gamle Markdown-indlæg. Filen kommer fra
// site/scripts/export-posts.mjs og indeholder allerede renderet HTML.
// Indlæg med samme slug springes over, så redigeringer i databasen bevares.
static async Task SeedPosts(WebApplication app)
{
    var seedPath = Path.Combine(app.Environment.ContentRootPath, "Seed", "posts.json");
    if (!File.Exists(seedPath)) return;

    try
    {
        var json = await File.ReadAllTextAsync(seedPath);
        var seeds = JsonSerializer.Deserialize<List<SeedPost>>(json, JsonDefaults.Web);
        if (seeds is not { Count: > 0 }) return;

        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BlogDb>();
        var existing = (await db.Posts.Select(p => p.Slug).ToListAsync()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var added = 0;

        foreach (var seed in seeds)
        {
            if (string.IsNullOrWhiteSpace(seed.Slug) || !ValidSlug(seed.Slug) || existing.Contains(seed.Slug)) continue;
            var title = Clean(seed.Title, 200);
            if (title.Length == 0) continue;

            var publishDate = seed.PublishDate;
            if (publishDate == default) publishDate = DateTime.UtcNow;
            if (publishDate.Kind == DateTimeKind.Local) publishDate = publishDate.ToUniversalTime();
            else if (publishDate.Kind == DateTimeKind.Unspecified) publishDate = DateTime.SpecifyKind(publishDate, DateTimeKind.Utc);

            DateTime? updated = seed.Updated;
            if (updated is { } u)
            {
                updated = u.Kind == DateTimeKind.Local ? u.ToUniversalTime() : DateTime.SpecifyKind(u, DateTimeKind.Utc);
            }

            var bodyMarkdown = seed.BodyMarkdown ?? "";
            var bodyHtml = SanitizeBody(seed.BodyHtml ?? "");
            var links = (seed.Links ?? [])
                .Where(l => l is not null && l.Title is { Length: > 0 } && Uri.TryCreate(l.Url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                .Take(20)
                .ToList();
            var interactive = seed.Interactive ?? new InteractiveInput(true, true, true, true);

            db.Posts.Add(new BlogPost
            {
                Slug = seed.Slug,
                Title = title,
                Description = Clean(seed.Description, 600) is { Length: > 0 } description ? description : null,
                BodyMarkdown = bodyMarkdown,
                BodyHtml = bodyHtml,
                Tldr = Clean(seed.Tldr, 1000) is { Length: > 0 } tldr ? tldr : null,
                PublishDate = publishDate,
                UpdatedAt = updated,
                Draft = seed.Draft ?? false,
                TagsJson = JsonSerializer.Serialize(CleanList(seed.Tags, 20, 40)),
                SitesJson = JsonSerializer.Serialize(CleanList(seed.Sites, 20, 40)),
                LinksJson = JsonSerializer.Serialize(links),
                Cover = Clean(seed.Cover, 500) is { Length: > 0 } cover ? cover : null,
                Video = Clean(seed.Video, 500) is { Length: > 0 } video ? video : null,
                VideoFormat = seed.VideoFormat == "lodret" ? "lodret" : seed.VideoFormat == "vandret" ? "vandret" : null,
                Font = seed.Font is "sans" or "mono" or "haandskrift" ? seed.Font : "serif",
                Voice = Clean(seed.Voice, 500) is { Length: > 0 } voice ? voice : null,
                Archived = seed.Archived ?? false,
                ReadingMinutes = seed.ReadingMinutes is > 0 and < 1000 ? seed.ReadingMinutes.Value : ReadingMinutes(bodyMarkdown, bodyHtml),
                InteractiveJson = JsonSerializer.Serialize(new
                {
                    comments = interactive.Comments ?? true,
                    highlights = interactive.Highlights ?? true,
                    graffiti = interactive.Graffiti ?? true,
                    readAloud = interactive.ReadAloud ?? true,
                }),
                CreatedAt = DateTime.UtcNow,
            });
            existing.Add(seed.Slug);
            added++;
        }

        if (added > 0)
        {
            await db.SaveChangesAsync();
            app.Logger.LogInformation("Seed: flyttede {Count} Markdown-indlæg til blog_posts.", added);
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Seed af gamle indlæg kunne ikke gennemføres; bloggen kører videre.");
    }
}

// Flytter de gamle /media/-billeder til blog_media. PublicPath bevarer
// den gamle URL, så /media/zoher4cl/hypo.jpg stadig virker.
static async Task SeedMedia(WebApplication app)
{
    var mediaRoot = Path.Combine(app.Environment.ContentRootPath, "Seed", "media");
    if (!Directory.Exists(mediaRoot)) return;

    try
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BlogDb>();
        var existing = (await db.Media
            .Where(m => m.PublicPath != null)
            .Select(m => m.PublicPath!)
            .ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var added = 0;

        foreach (var file in Directory.EnumerateFiles(mediaRoot, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(mediaRoot, file).Replace('\\', '/');
            var publicPath = $"/media/{relative}";
            if (existing.Contains(publicPath)) continue;

            var contentType = MediaContentType(null, file);
            if (contentType is null) continue;
            var bytes = await File.ReadAllBytesAsync(file);
            if (bytes.Length == 0 || bytes.Length > 45_000_000) continue;

            db.Media.Add(new BlogMedia
            {
                FileName = Path.GetFileName(file),
                ContentType = contentType,
                PublicPath = publicPath,
                Bytes = bytes,
                CreatedAt = DateTime.UtcNow,
            });
            existing.Add(publicPath);
            added++;
        }

        if (added > 0)
        {
            await db.SaveChangesAsync();
            app.Logger.LogInformation("Seed: flyttede {Count} gamle medier til blog_media.", added);
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Seed af gamle medier kunne ikke gennemføres; bloggen kører videre.");
    }
}

// Ældre blog_media-tabeller kan mangle PublicPath, som bevarer de gamle
// /media/-adresser. Kolonnen tilføjes én gang; fejler den, er den allerede der.
static async Task EnsureMediaPublicPath(string connection)
{
    var options = new DbContextOptionsBuilder<BlogMediaStoreDb>();
    if (connection.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase)) options.UseSqlite(connection);
    else options.UseMySQL(connection);

    await using var db = new BlogMediaStoreDb(options.Options);
    try
    {
        var sql = connection.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase)
            ? "ALTER TABLE blog_media ADD COLUMN PublicPath TEXT NULL;"
            : "ALTER TABLE blog_media ADD COLUMN PublicPath varchar(500) NULL;";
        await db.Database.ExecuteSqlRawAsync(sql);
    }
    catch
    {
        // Kolonnen findes allerede.
    }
}

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

// De to indholdstabeller kan mangle på en database, hvor de gamle tabeller allerede
// findes. Derfor oprettes de med hver sit lille context, så en eksisterende tabel
// ikke får EF til at prøve at oprette alle tabeller igen.
static async Task EnsureContentTables(string connection)
{
    await EnsureStore<BlogPostStoreDb>(connection, db => db.Posts.AnyAsync());
    await EnsureStore<BlogMediaStoreDb>(connection, db => db.Media.AnyAsync());
    await EnsureStore<BlogRevisionStoreDb>(connection, db => db.Revisions.AnyAsync());
    await EnsureStore<BlogAuditStoreDb>(connection, db => db.Audit.AnyAsync());
}

static async Task EnsurePostColumns(string connection)
{
    var options = new DbContextOptionsBuilder<BlogPostStoreDb>();
    if (connection.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase)) options.UseSqlite(connection);
    else options.UseMySQL(connection);

    await using var db = new BlogPostStoreDb(options.Options);
    foreach (var sql in connection.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase)
        ? new[] { "ALTER TABLE blog_posts ADD COLUMN DeletedAt TEXT NULL;", "ALTER TABLE blog_posts ADD COLUMN Captions TEXT NULL;" }
        : new[] { "ALTER TABLE blog_posts ADD COLUMN DeletedAt datetime(6) NULL;", "ALTER TABLE blog_posts ADD COLUMN Captions varchar(500) NULL;" })
    {
        try { await db.Database.ExecuteSqlRawAsync(sql); }
        catch { /* Kolonnen findes allerede. */ }
    }
}

static async Task EnsureStore<TDb>(string connection, Func<TDb, Task> probe) where TDb : DbContext
{
    var options = new DbContextOptionsBuilder<TDb>();
    if (connection.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase)) options.UseSqlite(connection);
    else options.UseMySQL(connection);

    await using var db = (TDb)Activator.CreateInstance(typeof(TDb), options.Options)!;
    try
    {
        await probe(db);
    }
    catch
    {
        var creator = db.GetService<IRelationalDatabaseCreator>();
        if (!await creator.ExistsAsync()) await creator.CreateAsync();
        await creator.CreateTablesAsync();
    }
}

static class JsonDefaults
{
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
}

record ChoiceInput(string? Voter, int? Option, int? Value);
record CommentInput(string? Voter, string? Name, string? Body, string? Website);
record AnnotationInput(string? Voter, string? Kind, string? Quote, string? Prefix, string? Suffix, string? Note, string? Name);
record StrokeInput(string? Voter, string? Color, double? Width, double[][]? Points);
record BlogPostInput(
    string? Title,
    string? Description,
    string? BodyMarkdown,
    string? BodyHtml,
    string? Tldr,
    DateTime? PublishDate,
    bool? Draft,
    string[]? Tags,
    string[]? Sites,
    List<LinkInput>? Links,
    string? Cover,
    string? Video,
    string? VideoFormat,
    string? Font,
    string? Voice,
    string? Captions,
    bool? Archived,
    int? ReadingMinutes,
    InteractiveInput? Interactive);
record LinkInput(string? Title, string? Url);
record InteractiveInput(bool? Comments, bool? Highlights, bool? Graffiti, bool? ReadAloud);
record NavPost(string Slug, string Title, DateTime PublishDate);
static class BlogSites
{
    public static readonly string[] Keys =
    [
        "villadsclaes", "mig", "longbets", "hyponet", "techtree",
        "goodbad", "quiz", "venskab", "foretagsomheden",
    ];
}

record SeedPost(
    string? Slug,
    string? Title,
    string? Description,
    string? BodyMarkdown,
    string? BodyHtml,
    string? Tldr,
    DateTime PublishDate,
    DateTime? Updated,
    bool? Draft,
    string[]? Tags,
    string[]? Sites,
    List<LinkInput>? Links,
    string? Cover,
    string? Video,
    string? VideoFormat,
    string? Font,
    string? Voice,
    bool? Archived,
    int? ReadingMinutes,
    InteractiveInput? Interactive);
