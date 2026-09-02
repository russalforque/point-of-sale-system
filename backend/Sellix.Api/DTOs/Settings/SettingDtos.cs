using System.ComponentModel.DataAnnotations;

namespace Sellix.Api.DTOs.Settings;

public class StoreSettingDto
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
    public bool ShowLogoOnReceipt { get; set; }
}

public class UpdateStoreSettingRequest
{
    [Required, MaxLength(200)]
    public string StoreName { get; set; } = string.Empty;

    [MaxLength(40)]
    public string? Phone { get; set; }

    [EmailAddress, MaxLength(160)]
    public string? Email { get; set; }

    [MaxLength(400)]
    public string? Address { get; set; }

    [Required, MaxLength(10)]
    public string Currency { get; set; } = "PHP";

    [Required, MaxLength(8)]
    public string CurrencySymbol { get; set; } = "₱";

    [Range(0, 1)]
    public decimal TaxRate { get; set; }

    [MaxLength(400)]
    public string ReceiptFooter { get; set; } = string.Empty;

    public bool ShowLogoOnReceipt { get; set; }
}
