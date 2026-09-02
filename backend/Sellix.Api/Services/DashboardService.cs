using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Dashboard;

namespace Sellix.Api.Services;

public class DashboardService
{
    private readonly AppDbContext _db;

    public DashboardService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<DashboardDto> GetAsync()
    {
        var phTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");
        var now = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, phTimeZone);
        var today = now.Date;
        var tomorrow = today.AddDays(1);
        var start = today.AddDays(-6);

        var recentWindow = await _db.Sales.AsNoTracking()
            .Where(s => s.CreatedAt >= start)
            .Select(s => new { s.CreatedAt, s.Total })
            .ToListAsync();

        var todaysSales = recentWindow.Where(s => s.CreatedAt >= today && s.CreatedAt < tomorrow).ToList();

        var overviewMap = recentWindow
            .GroupBy(s => s.CreatedAt.Date)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Total));
        var points = Enumerable.Range(0, 7).Select(i =>
        {
            var day = start.AddDays(i);
            return new SalesPointDto
            {
                Label = day.ToString("ddd"),
                Amount = overviewMap.TryGetValue(day, out var amt) ? amt : 0
            };
        }).ToList();

        var recent = await _db.Sales.AsNoTracking()
            .Include(s => s.Customer)
            .Include(s => s.Payment)
            .OrderByDescending(s => s.CreatedAt)
            .Take(8)
            .Select(s => new RecentSaleDto
            {
                Id = s.Id,
                InvoiceNumber = s.InvoiceNumber,
                CustomerName = s.Customer != null ? s.Customer.FullName : "Walk-in",
                Total = s.Total,
                PaymentMethod = s.Payment != null ? s.Payment.Method.ToString() : "",
                CreatedAt = s.CreatedAt
            })
            .ToListAsync();

        var lowStock = await _db.Products.AsNoTracking()
            .Where(p => p.IsActive && p.StockQuantity <= p.ReorderLevel)
            .OrderBy(p => p.StockQuantity)
            .Take(8)
            .Select(p => new LowStockDto
            {
                Id = p.Id,
                SKU = p.SKU,
                Name = p.Name,
                StockQuantity = p.StockQuantity,
                ReorderLevel = p.ReorderLevel
            })
            .ToListAsync();

        var monthStart = new DateTime(today.Year, today.Month, 1);
        var top = await _db.SaleItems.AsNoTracking()
            .Where(i => i.Sale.CreatedAt >= monthStart)
            .GroupBy(i => new { i.ProductId, i.Product.Name })
            .Select(g => new TopProductDto
            {
                ProductId = g.Key.ProductId,
                Name = g.Key.Name,
                QuantitySold = g.Sum(x => x.Quantity),
                Revenue = g.Sum(x => x.LineTotal)
            })
            .OrderByDescending(x => x.QuantitySold)
            .Take(5)
            .ToListAsync();

        return new DashboardDto
        {
            TodaysSales = todaysSales.Sum(s => s.Total),
            TodaysTransactions = todaysSales.Count,
            TotalCustomers = await _db.Customers.CountAsync(c => c.IsActive),
            TotalProducts = await _db.Products.CountAsync(p => p.IsActive),
            LowStockCount = await _db.Products.CountAsync(p => p.IsActive && p.StockQuantity <= p.ReorderLevel),
            SalesOverview = points,
            RecentTransactions = recent,
            LowStockProducts = lowStock,
            TopSellingProducts = top
        };
    }
}
