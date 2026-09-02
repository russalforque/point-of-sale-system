namespace Sellix.Api.DTOs.Reports;

public class ReportQuery
{
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
}

public class SalesPeriodDto
{
    public string Label { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public decimal Total { get; set; }
    public int Transactions { get; set; }
}

public class NamedAmountDto
{
    public string Name { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public int Count { get; set; }
}

public class ReportsDto
{
    public List<SalesPeriodDto> DailySales { get; set; } = new();
    public List<SalesPeriodDto> WeeklySales { get; set; } = new();
    public List<SalesPeriodDto> MonthlySales { get; set; } = new();
    public List<NamedAmountDto> SalesByProduct { get; set; } = new();
    public List<NamedAmountDto> SalesByCategory { get; set; } = new();
    public List<NamedAmountDto> SalesByPaymentMethod { get; set; } = new();
    public List<NamedAmountDto> TopSellingProducts { get; set; } = new();
    public InventoryStatusReportDto InventoryStatus { get; set; } = new();
}

public class InventoryStatusReportDto
{
    public int InStock { get; set; }
    public int LowStock { get; set; }
    public int OutOfStock { get; set; }
    public decimal InventoryValue { get; set; }
}
