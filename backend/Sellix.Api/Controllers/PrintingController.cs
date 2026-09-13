using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sellix.Api.DTOs.Printing;
using Sellix.Api.Services.Printing;
using Sellix.Api.Data;
using Sellix.Api.Models;
using Microsoft.EntityFrameworkCore;
using Sellix.Api.Exceptions;

namespace Sellix.Api.Controllers;

[ApiController, Authorize, Route("api/printing")]
public sealed class PrintingController : ControllerBase
{
    [HttpPost("receipt")]
    public async Task<IActionResult> PrintReceipt(ReceiptPrintRequest request, IReceiptPrintService service, CancellationToken cancellationToken)
        => Ok(new { printJobId = await service.PrintAsync(request, cancellationToken) });

    [HttpGet("agent/jobs/next"), AllowAnonymous]
    public async Task<IActionResult> NextAgentJob([FromHeader(Name = "X-Sellix-Agent-Key")] string? agentKey, AppDbContext db, IConfiguration configuration, CancellationToken cancellationToken)
    {
        EnsureAgentKey(agentKey, configuration);
        var now = DateTime.UtcNow;
        var job = await db.PrintJobs.Where(x =>
                (x.Status == PrintJobStatus.Pending || (x.Status == PrintJobStatus.Processing && x.LockedUntil < now)) && x.Attempts < 5)
            .OrderBy(x => x.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        if (job is null) return NoContent();
        job.Status = PrintJobStatus.Processing;
        job.Attempts++;
        job.LockedUntil = now.AddMinutes(2);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new { job.PrintJobId, job.ReceiptNumber, job.DataBase64, job.OpenCashDrawer });
    }

    [HttpPost("agent/jobs/{jobId:guid}/complete"), AllowAnonymous]
    public async Task<IActionResult> CompleteAgentJob(Guid jobId, [FromHeader(Name = "X-Sellix-Agent-Key")] string? agentKey, AppDbContext db, IConfiguration configuration, CancellationToken cancellationToken)
    {
        EnsureAgentKey(agentKey, configuration);
        var job = await db.PrintJobs.SingleOrDefaultAsync(x => x.PrintJobId == jobId, cancellationToken);
        if (job is null) return NotFound();
        job.Status = PrintJobStatus.Completed;
        job.CompletedAt = DateTime.UtcNow;
        job.LockedUntil = null;
        await db.SaveChangesAsync(cancellationToken);
        return Ok();
    }

    [HttpPost("agent/jobs/{jobId:guid}/fail"), AllowAnonymous]
    public async Task<IActionResult> FailAgentJob(Guid jobId, [FromHeader(Name = "X-Sellix-Agent-Key")] string? agentKey, [FromBody] AgentFailure failure, AppDbContext db, IConfiguration configuration, CancellationToken cancellationToken)
    {
        EnsureAgentKey(agentKey, configuration);
        var job = await db.PrintJobs.SingleOrDefaultAsync(x => x.PrintJobId == jobId, cancellationToken);
        if (job is null) return NotFound();
        job.Status = job.Attempts >= 5 ? PrintJobStatus.Failed : PrintJobStatus.Pending;
        job.LastError = failure.Message[..Math.Min(failure.Message.Length, 500)];
        job.LockedUntil = null;
        await db.SaveChangesAsync(cancellationToken);
        return Ok();
    }

    private static void EnsureAgentKey(string? supplied, IConfiguration configuration)
    {
        var expected = configuration["Printing:AgentKey"];
        if (string.IsNullOrWhiteSpace(expected) || !string.Equals(supplied, expected, StringComparison.Ordinal))
            throw new UnauthorizedAppException("Invalid print agent credentials.");
    }

    public sealed class AgentFailure { public string Message { get; set; } = "Print failed."; }
}