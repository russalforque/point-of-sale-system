using System.ComponentModel.DataAnnotations;
using Sellix.Api.Models;

namespace Sellix.Api.DTOs.Sales;

public class SaleItemRequest
{
    [Required]
    public int ProductId { get; set; }

    [Range(1, int.MaxValue)]
    public int Quantity { get; set; }
}

public class CreateSaleRequest
{
    public int? CustomerId { get; set; }

    [Range(0, double.MaxValue)]
    public decimal Discount { get; set; }

    [Required]
    public PaymentMethod PaymentMethod { get; set; }

    public decimal? AmountReceived { get; set; }

    [MaxLength(80)]
    public string? Reference { get; set; }

    [Required, MinLength(1)]
    public List<SaleItemRequest> Items { get; set; } = new();
}

public class SaleItemDto
{
    public int ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string SKU { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal LineTotal { get; set; }
}

public class SaleDto
{
    public int Id { get; set; }
    public string InvoiceNumber { get; set; } = string.Empty;
    public int? CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string CashierName { get; set; } = string.Empty;
    public decimal Subtotal { get; set; }
    public decimal Discount { get; set; }
    public decimal Tax { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string PaymentMethod { get; set; } = string.Empty;
    public decimal? AmountReceived { get; set; }
    public decimal? Change { get; set; }
    public List<SaleItemDto> Items { get; set; } = new();
}
