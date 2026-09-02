using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Suppliers;
using Sellix.Api.Exceptions;
using Sellix.Api.Models;

namespace Sellix.Api.Services;

public class SupplierService
{
    private readonly AppDbContext _db;

    public SupplierService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<SupplierDto>> ListAsync(string? search, bool? isActive)
    {
        var query = _db.Suppliers.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(s =>
                s.CompanyName.Contains(term) ||
                s.SupplierCode.Contains(term) ||
                (s.ContactPerson != null && s.ContactPerson.Contains(term)));
        }

        if (isActive.HasValue)
            query = query.Where(s => s.IsActive == isActive.Value);

        return await query.OrderBy(s => s.CompanyName).Select(s => Map(s)).ToListAsync();
    }

    public async Task<SupplierDto> GetAsync(int id)
    {
        var supplier = await _db.Suppliers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id)
            ?? throw new NotFoundException("Supplier not found.");
        return Map(supplier);
    }

    public async Task<SupplierDto> CreateAsync(UpsertSupplierRequest request)
    {
        var supplier = new Supplier
        {
            SupplierCode = await NextCodeAsync(),
            CompanyName = request.CompanyName.Trim(),
            ContactPerson = Trim(request.ContactPerson),
            Phone = Trim(request.Phone),
            Email = Trim(request.Email),
            Address = Trim(request.Address),
            IsActive = request.IsActive
        };
        _db.Suppliers.Add(supplier);
        await _db.SaveChangesAsync();
        return Map(supplier);
    }

    public async Task<SupplierDto> UpdateAsync(int id, UpsertSupplierRequest request)
    {
        var supplier = await _db.Suppliers.FirstOrDefaultAsync(s => s.Id == id)
            ?? throw new NotFoundException("Supplier not found.");

        supplier.CompanyName = request.CompanyName.Trim();
        supplier.ContactPerson = Trim(request.ContactPerson);
        supplier.Phone = Trim(request.Phone);
        supplier.Email = Trim(request.Email);
        supplier.Address = Trim(request.Address);
        supplier.IsActive = request.IsActive;
        await _db.SaveChangesAsync();
        return Map(supplier);
    }

    public async Task DeactivateAsync(int id)
    {
        var supplier = await _db.Suppliers.FirstOrDefaultAsync(s => s.Id == id)
            ?? throw new NotFoundException("Supplier not found.");
        supplier.IsActive = false;
        await _db.SaveChangesAsync();
    }

    private async Task<string> NextCodeAsync()
    {
        var last = await _db.Suppliers.OrderByDescending(s => s.Id).Select(s => s.SupplierCode).FirstOrDefaultAsync();
        var n = 1;
        if (last != null && last.StartsWith("SUP-") && int.TryParse(last[4..], out var parsed))
            n = parsed + 1;
        return $"SUP-{n:D4}";
    }

    private static string? Trim(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static SupplierDto Map(Supplier s) => new()
    {
        Id = s.Id,
        SupplierCode = s.SupplierCode,
        CompanyName = s.CompanyName,
        ContactPerson = s.ContactPerson,
        Phone = s.Phone,
        Email = s.Email,
        Address = s.Address,
        IsActive = s.IsActive
    };
}
