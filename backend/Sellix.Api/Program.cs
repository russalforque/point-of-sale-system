using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Sellix.Api.Data;
using Sellix.Api.Middleware;
using Sellix.Api.Models;
using Sellix.Api.Services;
using Sellix.Api.Services.Printing;

var builder = WebApplication.CreateBuilder(args);

// --------------------------------------------------
// Controllers
// --------------------------------------------------
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;

        options.JsonSerializerOptions.DefaultIgnoreCondition =
            System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
    })
    .ConfigureApiBehaviorOptions(options =>
    {
        options.InvalidModelStateResponseFactory = context =>
        {
            var errors = context.ModelState
                .Where(e => e.Value?.Errors.Count > 0)
                .ToDictionary(
                    e => e.Key,
                    e => e.Value!.Errors
                        .Select(x => x.ErrorMessage)
                        .ToArray());

            var message = errors
                .SelectMany(e => e.Value)
                .FirstOrDefault()
                ?? "Please correct the highlighted fields.";

            return new Microsoft.AspNetCore.Mvc.BadRequestObjectResult(
                new
                {
                    message,
                    errors
                });
        };
    });

// --------------------------------------------------
// Swagger
// --------------------------------------------------
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// --------------------------------------------------
// Database
// --------------------------------------------------
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection")
    ));

// --------------------------------------------------
// ASP.NET Identity
// --------------------------------------------------
builder.Services.AddIdentity<ApplicationUser, IdentityRole>(options =>
    {
        options.Password.RequiredLength = 8;
        options.Password.RequireDigit = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireNonAlphanumeric = true;

        options.User.RequireUniqueEmail = true;

        options.Lockout.MaxFailedAccessAttempts = 8;
        options.Lockout.DefaultLockoutTimeSpan =
            TimeSpan.FromMinutes(10);
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

// --------------------------------------------------
// JWT
// --------------------------------------------------
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException(
        "Jwt:Key is required."
    );

var jwtIssuer =
    builder.Configuration["Jwt:Issuer"]
    ?? "Sellix.Api";

var jwtAudience =
    builder.Configuration["Jwt:Audience"]
    ?? "Sellix.Client";

builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme =
            JwtBearerDefaults.AuthenticationScheme;

        options.DefaultChallengeScheme =
            JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters =
            new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateIssuerSigningKey = true,
                ValidateLifetime = true,

                ValidIssuer = jwtIssuer,
                ValidAudience = jwtAudience,

                IssuerSigningKey =
                    new SymmetricSecurityKey(
                        Encoding.UTF8.GetBytes(jwtKey)
                    ),

                ClockSkew = TimeSpan.FromMinutes(1)
            };

        options.Events = new JwtBearerEvents
        {
            OnChallenge = async context =>
            {
                context.HandleResponse();

                context.Response.StatusCode = 401;
                context.Response.ContentType =
                    "application/json";

                await context.Response.WriteAsJsonAsync(
                    new
                    {
                        message =
                            "Please sign in to continue."
                    });
            },

            OnForbidden = async context =>
            {
                context.Response.StatusCode = 403;
                context.Response.ContentType =
                    "application/json";

                await context.Response.WriteAsJsonAsync(
                    new
                    {
                        message =
                            "You do not have permission to do that."
                    });
            }
        };
    });

builder.Services.AddAuthorization();

// --------------------------------------------------
// CORS
// --------------------------------------------------
// Development configuration.
// AllowAnyOrigin is being used here so the Android
// Capacitor WebView can communicate with the local API.
//
// Android Emulator:
//     http://10.0.2.2:5290
//
// Capacitor WebView origin:
//     https://localhost
// --------------------------------------------------
builder.Services.AddCors(options =>
{
    options.AddPolicy("Client", policy =>
    {
        policy
            .AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

// --------------------------------------------------
// Application Services
// --------------------------------------------------
builder.Services.AddScoped<JwtTokenService>();
builder.Services.AddScoped<AuthService>();

builder.Services.AddScoped<CustomerService>();
builder.Services.AddScoped<CategoryService>();
builder.Services.AddScoped<SupplierService>();
builder.Services.AddScoped<ProductService>();
builder.Services.AddScoped<InventoryService>();
builder.Services.AddScoped<SalesService>();
builder.Services.AddScoped<DashboardService>();
builder.Services.AddScoped<ReportService>();
builder.Services.AddScoped<SettingsService>();

builder.Services.AddScoped<
    IReceiptPrintService,
    ReceiptPrintService
>();

// --------------------------------------------------
// Build application
// --------------------------------------------------
var app = builder.Build();

// --------------------------------------------------
// Swagger
// --------------------------------------------------
app.UseSwagger();
app.UseSwaggerUI();

// --------------------------------------------------
// CORS
// IMPORTANT: CORS runs before controllers/auth.
// --------------------------------------------------
app.UseCors("Client");

// --------------------------------------------------
// Exception handling
// --------------------------------------------------
app.UseMiddleware<ExceptionHandlingMiddleware>();

// --------------------------------------------------
// HTTPS
// Only redirect in non-development environments.
// This keeps the local Android API on HTTP :5290.
// --------------------------------------------------
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// --------------------------------------------------
// Authentication / Authorization
// --------------------------------------------------
app.UseAuthentication();
app.UseAuthorization();

// --------------------------------------------------
// Controllers
// --------------------------------------------------
app.MapControllers();

// --------------------------------------------------
// Seed database
// --------------------------------------------------
await DbSeeder.SeedAsync(app.Services);

// --------------------------------------------------
// Run
// --------------------------------------------------
app.Run();