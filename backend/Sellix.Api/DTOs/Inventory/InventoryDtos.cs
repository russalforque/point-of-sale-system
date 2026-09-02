using System.ComponentModel.DataAnnotations;
using Sellix.Api.Models;

namespace Sellix.Api.DTOs.Inventory;

public class InventoryItemDto
{
    public int ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string SKU { get; set; } = string.Empty;
    public int StockQuantity { get; set; }
    public int ReorderLevel { get; set; }
    public string StockStatus { get; set; } = string.Empty;
    public DateTime LastUpdated { get; set; }
}

public class InventoryHistoryDto
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string SKU { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public int QuantityChange { get; set; }
    public int QuantityAfter { get; set; }
    public string Reason { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class AdjustStockRequest
{
    [Required]
    public int ProductId { get; set; }

    [Required]
    public InventoryTransactionType Type { get; set; }

    [Range(1, int.MaxValue)]
    public int Quantity { get; set; }

    [Required, MaxLength(300)]
    public string Reason { get; set; } = string.Empty;
}
