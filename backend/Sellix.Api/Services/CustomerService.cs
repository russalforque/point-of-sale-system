using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Common;
using Sellix.Api.DTOs.Customers;
using Sellix.Api.Exceptions;
using Sellix.Api.Models;

namespace Sellix.Api.Services;

public class CustomerService
{
    private readonly AppDbContext _db;

    public CustomerService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<PagedResult<CustomerDto>> ListAsync(string? search, bool? isActive, int page, int pageSize)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var query = _db.Customers.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(c =>
                c.FullName.Contains(term) ||
                c.CustomerCode.Contains(term) ||
                (c.Phone != null && c.Phone.Contains(term)) ||
                (c.Email != null && c.Email.Contains(term)));
        }

        if (isActive.HasValue)
            query = query.Where(c => c.IsActive == isActive.Value);

        var total = await query.CountAsync();
        var items = await query
            .OrderBy(c => c.FullName)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(c => Map(c))
            .ToListAsync();

        return new PagedResult<CustomerDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    public async Task<List<CustomerDto>> LookupAsync(string? search)
    {
        var query = _db.Customers.AsNoTracking().Where(c => c.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(c => c.FullName.Contains(term) || c.CustomerCode.Contains(term) || (c.Phone != null && c.Phone.Contains(term)));
        }

        return await query.OrderBy(c => c.FullName).Take(20).Select(c => Map(c)).ToListAsync();
    }

    public async Task<CustomerDto> GetAsync(int id)
    {
        var customer = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id)
            ?? throw new NotFoundException("Customer not found.");
        return Map(customer);
    }

    public async Task<CustomerDto> CreateAsync(UpsertCustomerRequest request)
    {
        var customer = new Customer
        {
            CustomerCode = await NextCodeAsync(),
            FullName = request.FullName.Trim(),
            Phone = Trim(request.Phone),
            Email = Trim(request.Email),
            Address = Trim(request.Address),
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow,
            LoyaltyPoints = 0
        };

        _db.Customers.Add(customer);
        await _db.SaveChangesAsync();
        return Map(customer);
    }

    public async Task<CustomerDto> UpdateAsync(int id, UpsertCustomerRequest request)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id)
            ?? throw new NotFoundException("Customer not found.");

        customer.FullName = request.FullName.Trim();
        customer.Phone = Trim(request.Phone);
        customer.Email = Trim(request.Email);
        customer.Address = Trim(request.Address);
        customer.IsActive = request.IsActive;
        await _db.SaveChangesAsync();
        return Map(customer);
    }

    public async Task DeactivateAsync(int id)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id)
            ?? throw new NotFoundException("Customer not found.");
        customer.IsActive = false;
        await _db.SaveChangesAsync();
    }

    private async Task<string> NextCodeAsync()
    {
        var last = await _db.Customers.OrderByDescending(c => c.Id).Select(c => c.CustomerCode).FirstOrDefaultAsync();
        var n = 1;
        if (last != null && last.StartsWith("CUST-") && int.TryParse(last[5..], out var parsed))
            n = parsed + 1;
        return $"CUST-{n:D4}";
    }

    private static string? Trim(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static CustomerDto Map(Customer c) => new()
    {
        Id = c.Id,
        CustomerCode = c.CustomerCode,
        FullName = c.FullName,
        Phone = c.Phone,
        Email = c.Email,
        Address = c.Address,
        IsActive = c.IsActive,
        CreatedAt = c.CreatedAt,
        LoyaltyPoints = c.LoyaltyPoints
    };
}
