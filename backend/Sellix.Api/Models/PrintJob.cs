namespace Sellix.Api.Models;

public enum PrintJobStatus
{
    Pending,
    Processing,
    Completed,
    Failed
}

public sealed class PrintJob
{
    public int Id { get; set; }
    public Guid PrintJobId { get; set; } = Guid.NewGuid();
    public int TransactionId { get; set; }
    public string ReceiptNumber { get; set; } = string.Empty;
    public string DataBase64 { get; set; } = string.Empty;
    public bool OpenCashDrawer { get; set; }
    public PrintJobStatus Status { get; set; } = PrintJobStatus.Pending;
    public int Attempts { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LockedUntil { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? LastError { get; set; }
}