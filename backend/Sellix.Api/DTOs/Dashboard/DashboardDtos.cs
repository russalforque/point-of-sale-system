namespace Sellix.Api.DTOs.Dashboard;

public class DashboardDto
{
    public decimal TodaysSales { get; set; }
    public int TodaysTransactions { get; set; }
    public int TotalCustomers { get; set; }
    public int TotalProducts { get; set; }
    public int LowStockCount { get; set; }
    public List<SalesPointDto> SalesOverview { get; set; } = new();
    public List<RecentSaleDto> RecentTransactions { get; set; } = new();
    public List<LowStockDto> LowStockProducts { get; set; } = new();
    public List<TopProductDto> TopSellingProducts { get; set; } = new();
}

public class SalesPointDto
{
    public string Label { get; set; } = string.Empty;
    public decimal Amount { get; set; }
}

public class RecentSaleDto
{
    public int Id { get; set; }
    public string InvoiceNumber { get; set; } = string.Empty;
    public string? CustomerName { get; set; }
    public decimal Total { get; set; }
    public string PaymentMethod { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class LowStockDto
{
    public int Id { get; set; }
    public string SKU { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int StockQuantity { get; set; }
    public int ReorderLevel { get; set; }
}

public class TopProductDto
{
    public int ProductId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int QuantitySold { get; set; }
    public decimal Revenue { get; set; }
}
