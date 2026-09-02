namespace Sellix.Api.Models;

public class StoreSetting
{
    public int Id { get; set; }
    public string StoreName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Address { get; set; }
    public string Currency { get; set; } = "PHP";
    public string CurrencySymbol { get; set; } = "₱";
    public decimal TaxRate { get; set; }
    public string ReceiptFooter { get; set; } = string.Empty;
    public bool ShowLogoOnReceipt { get; set; } = true;
}
