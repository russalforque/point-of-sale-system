using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Common;
using Sellix.Api.DTOs.Sales;
using Sellix.Api.Exceptions;
using Sellix.Api.Models;

namespace Sellix.Api.Services;

public class SalesService
{
    private readonly AppDbContext _db;

    public SalesService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<PagedResult<SaleDto>> ListAsync(string? search, int page, int pageSize)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var query = _db.Sales.AsNoTracking()
            .Include(s => s.Customer)
            .Include(s => s.Cashier)
            .Include(s => s.Payment)
            .Include(s => s.SaleItems).ThenInclude(i => i.Product)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(s =>
                s.InvoiceNumber.Contains(term) ||
                (s.Customer != null && s.Customer.FullName.Contains(term)));
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return new PagedResult<SaleDto>
        {
            Items = items.Select(Map).ToList(),
            TotalCount = total,
            Page = page,
            PageSize = pageSize
        };
    }

    public async Task<SaleDto> GetAsync(int id)
    {
        var sale = await _db.Sales.AsNoTracking()
            .Include(s => s.Customer)
            .Include(s => s.Cashier)
            .Include(s => s.Payment)
            .Include(s => s.SaleItems).ThenInclude(i => i.Product)
            .FirstOrDefaultAsync(s => s.Id == id) ?? throw new NotFoundException("Sale not found.");
        return Map(sale);
    }

    public async Task<SaleDto> CreateAsync(CreateSaleRequest request, string cashierId)
    {
        if (request.Items.Count == 0)
            throw new AppException("Cart cannot be empty.");

        if (request.Discount < 0)
            throw new AppException("Discount cannot be negative.");

        if (request.CustomerId.HasValue && !await _db.Customers.AnyAsync(c => c.Id == request.CustomerId && c.IsActive))
            throw new AppException("Selected customer is not available.");

        var grouped = request.Items
            .GroupBy(i => i.ProductId)
            .Select(g => new { ProductId = g.Key, Quantity = g.Sum(x => x.Quantity) })
            .ToList();

        await using var tx = await _db.Database.BeginTransactionAsync();

        var productIds = grouped.Select(g => g.ProductId).ToList();
        var products = await _db.Products.Where(p => productIds.Contains(p.Id)).ToListAsync();
        if (products.Count != productIds.Count)
            throw new AppException("One or more products are invalid.");

        var settings = await _db.StoreSettings.FirstAsync();
        var subtotal = 0m;
        var saleItems = new List<SaleItem>();
        var now = DateTime.UtcNow;

        foreach (var line in grouped)
        {
            var product = products.First(p => p.Id == line.ProductId);
            if (!product.IsActive)
                throw new AppException($"{product.Name} is not available for sale.");
            if (line.Quantity > product.StockQuantity)
                throw new AppException($"Insufficient stock for {product.Name}. Available: {product.StockQuantity}.");

            var lineTotal = product.SellingPrice * line.Quantity;
            subtotal += lineTotal;
            product.StockQuantity -= line.Quantity;
            product.UpdatedAt = now;

            saleItems.Add(new SaleItem
            {
                ProductId = product.Id,
                Quantity = line.Quantity,
                UnitPrice = product.SellingPrice,
                LineTotal = lineTotal
            });

            _db.InventoryTransactions.Add(new InventoryTransaction
            {
                ProductId = product.Id,
                Type = InventoryTransactionType.Sale,
                QuantityChange = -line.Quantity,
                QuantityAfter = product.StockQuantity,
                Reason = "POS sale",
                CreatedBy = cashierId,
                CreatedAt = now
            });
        }

        if (request.Discount > subtotal)
            throw new AppException("Discount cannot exceed subtotal.");

        var taxable = subtotal - request.Discount;
        var tax = Math.Round(taxable * settings.TaxRate, 2, MidpointRounding.AwayFromZero);
        var total = taxable + tax;

        decimal? change = null;
        if (request.PaymentMethod == PaymentMethod.Cash)
        {
            if (!request.AmountReceived.HasValue)
                throw new AppException("Cash received is required for cash payments.");
            if (request.AmountReceived.Value < total)
                throw new AppException("Cash received is less than the total due.");
            change = request.AmountReceived.Value - total;
        }

        var sale = new Sale
        {
            InvoiceNumber = await NextInvoiceAsync(now),
            CustomerId = request.CustomerId,
            CashierId = cashierId,
            Subtotal = subtotal,
            Discount = request.Discount,
            Tax = tax,
            Total = total,
            Status = SaleStatus.Completed,
            CreatedAt = now,
            SaleItems = saleItems,
            Payment = new Payment
            {
                Method = request.PaymentMethod,
                Amount = total,
                AmountReceived = request.AmountReceived,
                Change = change,
                Reference = string.IsNullOrWhiteSpace(request.Reference) ? null : request.Reference.Trim()
            }
        };

        if (request.CustomerId.HasValue)
        {
            var customer = await _db.Customers.FirstAsync(c => c.Id == request.CustomerId.Value);
            customer.LoyaltyPoints += (int)Math.Floor(total / 50m);
        }

        _db.Sales.Add(sale);
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        return await GetAsync(sale.Id);
    }

    private async Task<string> NextInvoiceAsync(DateTime now)
    {
        var prefix = $"SLX-{now:yyyyMMdd}-";
        var last = await _db.Sales
            .Where(s => s.InvoiceNumber.StartsWith(prefix))
            .OrderByDescending(s => s.InvoiceNumber)
            .Select(s => s.InvoiceNumber)
            .FirstOrDefaultAsync();

        var n = 1;
        if (last != null)
        {
            var suffix = last[prefix.Length..];
            if (int.TryParse(suffix, out var parsed))
                n = parsed + 1;
        }

        return $"{prefix}{n:D4}";
    }

    private static SaleDto Map(Sale s) => new()
    {
        Id = s.Id,
        InvoiceNumber = s.InvoiceNumber,
        CustomerId = s.CustomerId,
        CustomerName = s.Customer?.FullName,
        CashierName = s.Cashier.FullName,
        Subtotal = s.Subtotal,
        Discount = s.Discount,
        Tax = s.Tax,
        Total = s.Total,
        Status = s.Status.ToString(),
        CreatedAt = s.CreatedAt,
        PaymentMethod = s.Payment?.Method.ToString() ?? string.Empty,
        AmountReceived = s.Payment?.AmountReceived,
        Change = s.Payment?.Change,
        Items = s.SaleItems.Select(i => new SaleItemDto
        {
            ProductId = i.ProductId,
            ProductName = i.Product.Name,
            SKU = i.Product.SKU,
            Quantity = i.Quantity,
            UnitPrice = i.UnitPrice,
            LineTotal = i.LineTotal
        }).ToList()
    };
}
