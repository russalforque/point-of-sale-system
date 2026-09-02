using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Common;
using Sellix.Api.DTOs.Products;
using Sellix.Api.Exceptions;
using Sellix.Api.Models;

namespace Sellix.Api.Services;

public class ProductService
{
    private readonly AppDbContext _db;

    public ProductService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<PagedResult<ProductDto>> ListAsync(string? search, int? categoryId, string? stockStatus, bool? isActive, int page, int pageSize)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.Products.AsNoTracking().Include(p => p.Category).Include(p => p.Supplier).AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(p => p.Name.Contains(term) || p.SKU.Contains(term));
        }

        if (categoryId.HasValue)
            query = query.Where(p => p.CategoryId == categoryId.Value);

        if (isActive.HasValue)
            query = query.Where(p => p.IsActive == isActive.Value);

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
            .ToListAsync();

        return new PagedResult<ProductDto>
        {
            Items = items.Select(Map).ToList(),
            TotalCount = total,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<List<ProductDto>> PosCatalogAsync(string? search, int? categoryId)
    {
        var query = _db.Products.AsNoTracking()
            .Include(p => p.Category)
            .Include(p => p.Supplier)
            .Where(p => p.IsActive);

        if (categoryId.HasValue)
            query = query.Where(p => p.CategoryId == categoryId.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(p => p.Name.Contains(term) || p.SKU.Contains(term));
        }

        var items = await query.OrderBy(p => p.Name).Take(120).ToListAsync();
        return items.Select(Map).ToList();
    }

    public async Task<ProductDto> GetAsync(int id)
    {
        var product = await _db.Products.AsNoTracking()
            .Include(p => p.Category)
            .Include(p => p.Supplier)
            .FirstOrDefaultAsync(p => p.Id == id) ?? throw new NotFoundException("Product not found.");
        return Map(product);
    }

    public async Task<ProductDto> CreateAsync(UpsertProductRequest request)
    {
        await ValidateRelations(request);
        if (await _db.Products.AnyAsync(p => p.SKU == request.SKU.Trim()))
            throw new ConflictException("A product with this SKU already exists.");

        var now = DateTime.UtcNow;
        var product = new Product
        {
            SKU = request.SKU.Trim(),
            Name = request.Name.Trim(),
            Description = Trim(request.Description),
            CategoryId = request.CategoryId,
            SupplierId = request.SupplierId,
            CostPrice = request.CostPrice,
            SellingPrice = request.SellingPrice,
            StockQuantity = request.StockQuantity,
            ReorderLevel = request.ReorderLevel,
            IsActive = request.IsActive,
            ImageUrl = Trim(request.ImageUrl),
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.Products.Add(product);
        if (product.StockQuantity > 0)
        {
            _db.InventoryTransactions.Add(new InventoryTransaction
            {
                Product = product,
                Type = InventoryTransactionType.Increase,
                QuantityChange = product.StockQuantity,
                QuantityAfter = product.StockQuantity,
                Reason = "Initial stock",
                CreatedAt = now
            });
        }

        await _db.SaveChangesAsync();
        return await GetAsync(product.Id);
    }

    public async Task<ProductDto> UpdateAsync(int id, UpsertProductRequest request)
    {
        await ValidateRelations(request);
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id)
            ?? throw new NotFoundException("Product not found.");

        if (await _db.Products.AnyAsync(p => p.SKU == request.SKU.Trim() && p.Id != id))
            throw new ConflictException("A product with this SKU already exists.");

        product.SKU = request.SKU.Trim();
        product.Name = request.Name.Trim();
        product.Description = Trim(request.Description);
        product.CategoryId = request.CategoryId;
        product.SupplierId = request.SupplierId;
        product.CostPrice = request.CostPrice;
        product.SellingPrice = request.SellingPrice;
        product.ReorderLevel = request.ReorderLevel;
        product.IsActive = request.IsActive;
        product.ImageUrl = Trim(request.ImageUrl);
        product.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return await GetAsync(id);
    }

    public async Task DeactivateAsync(int id)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id)
            ?? throw new NotFoundException("Product not found.");
        product.IsActive = false;
        product.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    private async Task ValidateRelations(UpsertProductRequest request)
    {
        if (!await _db.Categories.AnyAsync(c => c.Id == request.CategoryId))
            throw new AppException("Selected category does not exist.");
        if (request.SupplierId.HasValue && !await _db.Suppliers.AnyAsync(s => s.Id == request.SupplierId.Value))
            throw new AppException("Selected supplier does not exist.");
    }

    private static string? Trim(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static ProductDto Map(Product p) => new()
    {
        Id = p.Id,
        SKU = p.SKU,
        Name = p.Name,
        Description = p.Description,
        CategoryId = p.CategoryId,
        CategoryName = p.Category.Name,
        SupplierId = p.SupplierId,
        SupplierName = p.Supplier?.CompanyName,
        CostPrice = p.CostPrice,
        SellingPrice = p.SellingPrice,
        StockQuantity = p.StockQuantity,
        ReorderLevel = p.ReorderLevel,
        IsActive = p.IsActive,
        CreatedAt = p.CreatedAt,
        UpdatedAt = p.UpdatedAt,
        ImageUrl = p.ImageUrl,
        StockStatus = StockStatus.FromQuantity(p.StockQuantity, p.ReorderLevel)
    };
}
