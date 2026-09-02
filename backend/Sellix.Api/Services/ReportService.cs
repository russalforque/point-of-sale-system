using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Reports;

namespace Sellix.Api.Services;

public class ReportService
{
    private readonly AppDbContext _db;

    public ReportService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<ReportsDto> GetAsync(DateTime? from, DateTime? to)
    {
        var phTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");
        var now = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, phTimeZone);
        var end = (to ?? now).Date.AddDays(1);
        var start = (from ?? now.Date.AddDays(-29)).Date;

        var sales = await _db.Sales.AsNoTracking()
            .Include(s => s.Payment)
            .Include(s => s.SaleItems).ThenInclude(i => i.Product).ThenInclude(p => p.Category)
            .Where(s => s.CreatedAt >= start && s.CreatedAt < end)
            .ToListAsync();

        var daily = sales
            .GroupBy(s => s.CreatedAt.Date)
            .OrderBy(g => g.Key)
            .Select(g => new SalesPeriodDto
            {
                Date = g.Key,
                Label = g.Key.ToString("MMM d"),
                Total = g.Sum(x => x.Total),
                Transactions = g.Count()
            })
            .ToList();

        var weekly = sales
            .GroupBy(s => ISOWeekStart(s.CreatedAt.Date))
            .OrderBy(g => g.Key)
            .Select(g => new SalesPeriodDto
            {
                Date = g.Key,
                Label = $"Week of {g.Key:MMM d}",
                Total = g.Sum(x => x.Total),
                Transactions = g.Count()
            })
            .ToList();

        var monthly = sales
            .GroupBy(s => new DateTime(s.CreatedAt.Year, s.CreatedAt.Month, 1))
            .OrderBy(g => g.Key)
            .Select(g => new SalesPeriodDto
            {
                Date = g.Key,
                Label = g.Key.ToString("MMM yyyy"),
                Total = g.Sum(x => x.Total),
                Transactions = g.Count()
            })
            .ToList();

        var items = sales.SelectMany(s => s.SaleItems).ToList();

        var byProduct = items
            .GroupBy(i => i.Product.Name)
            .Select(g => new NamedAmountDto { Name = g.Key, Amount = g.Sum(x => x.LineTotal), Count = g.Sum(x => x.Quantity) })
            .OrderByDescending(x => x.Amount)
            .Take(12)
            .ToList();

        var byCategory = items
            .GroupBy(i => i.Product.Category.Name)
            .Select(g => new NamedAmountDto { Name = g.Key, Amount = g.Sum(x => x.LineTotal), Count = g.Sum(x => x.Quantity) })
            .OrderByDescending(x => x.Amount)
            .ToList();

        var byPayment = sales
            .Where(s => s.Payment != null)
            .GroupBy(s => s.Payment!.Method.ToString())
            .Select(g => new NamedAmountDto { Name = g.Key, Amount = g.Sum(x => x.Total), Count = g.Count() })
            .OrderByDescending(x => x.Amount)
            .ToList();

        var top = items
            .GroupBy(i => i.Product.Name)
            .Select(g => new NamedAmountDto { Name = g.Key, Amount = g.Sum(x => x.LineTotal), Count = g.Sum(x => x.Quantity) })
            .OrderByDescending(x => x.Count)
            .Take(10)
            .ToList();

        var products = await _db.Products.AsNoTracking().Where(p => p.IsActive).ToListAsync();

        return new ReportsDto
        {
            DailySales = daily,
            WeeklySales = weekly,
            MonthlySales = monthly,
            SalesByProduct = byProduct,
            SalesByCategory = byCategory,
            SalesByPaymentMethod = byPayment,
            TopSellingProducts = top,
            InventoryStatus = new InventoryStatusReportDto
            {
                InStock = products.Count(p => p.StockQuantity > p.ReorderLevel),
                LowStock = products.Count(p => p.StockQuantity > 0 && p.StockQuantity <= p.ReorderLevel),
                OutOfStock = products.Count(p => p.StockQuantity <= 0),
                InventoryValue = products.Sum(p => p.CostPrice * p.StockQuantity)
            }
        };
    }

    private static DateTime ISOWeekStart(DateTime date)
    {
        var diff = ((int)date.DayOfWeek + 6) % 7;
        return date.AddDays(-diff);
    }
}
