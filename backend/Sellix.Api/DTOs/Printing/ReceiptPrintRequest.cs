using System.ComponentModel.DataAnnotations;

namespace Sellix.Api.DTOs.Printing;

public sealed class ReceiptPrintRequest
{
    [Required, MaxLength(80)] public string ReceiptNumber { get; set; } = string.Empty;
    [Range(1, int.MaxValue)] public int TransactionId { get; set; }
    public DateTime TransactionDate { get; set; }
    [Required, MaxLength(120)] public string StoreName { get; set; } = string.Empty;
    [MaxLength(240)] public string? StoreAddress { get; set; }
    [MaxLength(40)] public string? StorePhone { get; set; }
    [Required, MaxLength(120)] public string CashierName { get; set; } = string.Empty;
    [MaxLength(120)] public string? CustomerName { get; set; }
    [Required, MinLength(1)] public List<ReceiptItemRequest> Items { get; set; } = new();
    [Range(0, double.MaxValue)] public decimal Subtotal { get; set; }
    [Range(0, double.MaxValue)] public decimal DiscountTotal { get; set; }
    [Range(0, double.MaxValue)] public decimal Tax { get; set; }
    [Range(0, double.MaxValue)] public decimal GrandTotal { get; set; }
    [Required, MaxLength(30)] public string PaymentMethod { get; set; } = string.Empty;
    [Range(0, double.MaxValue)] public decimal? AmountPaid { get; set; }
    [Range(0, double.MaxValue)] public decimal? Change { get; set; }
    [MaxLength(240)] public string? FooterMessage { get; set; }
    [Range(16, 64)] public int CharactersPerLine { get; set; } = 32;
    public bool OpenCashDrawer { get; set; }
}

public sealed class ReceiptItemRequest
{
    [Required, MaxLength(160)] public string ProductName { get; set; } = string.Empty;
    [MaxLength(80)] public string? SKU { get; set; }
    [Range(1, int.MaxValue)] public int Quantity { get; set; }
    [Range(0, double.MaxValue)] public decimal UnitPrice { get; set; }
    [Range(0, double.MaxValue)] public decimal Discount { get; set; }
    [Range(0, double.MaxValue)] public decimal Total { get; set; }
}

public sealed class PrintAgentJob
{
    public Guid PrintJobId { get; init; } = Guid.NewGuid();
    public string ReceiptNumber { get; init; } = string.Empty;
    public string DataBase64 { get; init; } = string.Empty;
    public bool OpenCashDrawer { get; init; }
}