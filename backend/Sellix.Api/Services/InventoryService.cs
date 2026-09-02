using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Common;
using Sellix.Api.DTOs.Inventory;
using Sellix.Api.Exceptions;
using Sellix.Api.Models;

namespace Sellix.Api.Services;

public class InventoryService
{
    private readonly AppDbContext _db;

    public InventoryService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<PagedResult<InventoryItemDto>> ListAsync(string? search, string? stockStatus, int page, int pageSize)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var query = _db.Products.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(p => p.Name.Contains(term) || p.SKU.Contains(term));
        }

        if (!string.IsNullOrWhiteSpace(stockStatus))
        {
            query = stockStatus switch
            {
                "Out of Stock" => query.Where(p => p.StockQuantity <= 0),
                "Low Stock" => query.Where(p => p.StockQuantity > 0 && p.StockQuantity <= p.ReorderLevel),
                "In Stock" => query.Where(p => p.StockQuantity > p.ReorderLevel),
                _ => query
            };
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderBy(p => p.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(p => new InventoryItemDto
            {
                ProductId = p.Id,
                ProductName = p.Name,
                SKU = p.SKU,
                StockQuantity = p.StockQuantity,
                ReorderLevel = p.ReorderLevel,
                StockStatus = p.StockQuantity <= 0 ? "Out of Stock" : p.StockQuantity <= p.ReorderLevel ? "Low Stock" : "In Stock",
                LastUpdated = p.UpdatedAt
            })
            .ToListAsync();

        return new PagedResult<InventoryItemDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    public async Task<PagedResult<InventoryHistoryDto>> HistoryAsync(int? productId, int page, int pageSize)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var query = _db.InventoryTransactions.AsNoTracking().Include(t => t.Product).AsQueryable();
        if (productId.HasValue)
            query = query.Where(t => t.ProductId == productId.Value);

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(t => t.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new InventoryHistoryDto
            {
                Id = t.Id,
                ProductId = t.ProductId,
                ProductName = t.Product.Name,
                SKU = t.Product.SKU,
                Type = t.Type.ToString(),
                QuantityChange = t.QuantityChange,
                QuantityAfter = t.QuantityAfter,
                Reason = t.Reason,
                CreatedAt = t.CreatedAt
            })
            .ToListAsync();

        return new PagedResult<InventoryHistoryDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    public async Task AdjustAsync(AdjustStockRequest request, string? userId)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == request.ProductId)
            ?? throw new NotFoundException("Product not found.");

        var delta = request.Type switch
        {
            InventoryTransactionType.Increase => request.Quantity,
            InventoryTransactionType.Decrease => -request.Quantity,
            InventoryTransactionType.Adjustment => request.Quantity,
            _ => throw new AppException("Invalid inventory adjustment type.")
        };

        var next = product.StockQuantity + delta;
        if (next < 0)
            throw new AppException("Inventory cannot become negative.");

        product.StockQuantity = next;
        product.UpdatedAt = DateTime.UtcNow;

        _db.InventoryTransactions.Add(new InventoryTransaction
        {
            ProductId = product.Id,
            Type = request.Type,
            QuantityChange = delta,
            QuantityAfter = next,
            Reason = request.Reason.Trim(),
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow
        });

        await _db.SaveChangesAsync();
    }
}
