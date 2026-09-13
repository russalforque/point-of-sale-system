using Sellix.PrintAgent;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:17891");
builder.Services.Configure<PrinterConfiguration>(builder.Configuration.GetSection("Printer"));
builder.Services.AddSingleton<PrinterService>();
builder.Services.AddHttpClient();

var app = builder.Build();
_ = Task.Run(() => app.Services.GetRequiredService<PrinterService>().PollAsync(CancellationToken.None));
app.MapGet("/status", (PrinterService printer) => Results.Ok(printer.GetStatus()));
app.MapPost("/print", async (PrintAgentJob job, PrinterService printer, CancellationToken cancellationToken) =>
{
    try
    {
        await printer.PrintAsync(job, cancellationToken);
        return Results.Ok(new { success = true, job.PrintJobId });
    }
    catch (Exception exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});
app.Run();

public sealed class PrintAgentJob
{
    public Guid PrintJobId { get; init; }
    public string ReceiptNumber { get; init; } = string.Empty;
    public string DataBase64 { get; init; } = string.Empty;
    public bool OpenCashDrawer { get; init; }
}