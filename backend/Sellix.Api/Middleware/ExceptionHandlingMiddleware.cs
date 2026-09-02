using System.Net;
using System.Text.Json;
using Sellix.Api.Exceptions;

namespace Sellix.Api.Middleware;

public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task Invoke(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            await WriteError(context, ex);
        }
    }

    private async Task WriteError(HttpContext context, Exception ex)
    {
        var status = HttpStatusCode.InternalServerError;
        var message = "An unexpected error occurred. Please try again.";

        switch (ex)
        {
            case AppException app:
                status = (HttpStatusCode)app.StatusCode;
                message = app.Message;
                break;
            default:
                _logger.LogError(ex, "Unhandled exception");
                break;
        }

        context.Response.ContentType = "application/json";
        context.Response.StatusCode = (int)status;

        var payload = JsonSerializer.Serialize(new { message }, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });

        await context.Response.WriteAsync(payload);
    }
}
