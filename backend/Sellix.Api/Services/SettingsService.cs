using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Settings;
using Sellix.Api.Exceptions;
using Sellix.Api.Models;

namespace Sellix.Api.Services;

public class SettingsService
{
    private readonly AppDbContext _db;

    public SettingsService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<StoreSettingDto> GetAsync()
    {
        var s = await _db.StoreSettings.AsNoTracking().FirstOrDefaultAsync()
            ?? throw new NotFoundException("Store settings were not found.");
        return Map(s);
    }

    public async Task<StoreSettingDto> UpdateAsync(UpdateStoreSettingRequest request)
    {
        var s = await _db.StoreSettings.FirstOrDefaultAsync()
            ?? throw new NotFoundException("Store settings were not found.");

        s.StoreName = request.StoreName.Trim();
        s.Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
        s.Email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim();
        s.Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();
        s.Currency = request.Currency.Trim();
        s.CurrencySymbol = request.CurrencySymbol.Trim();
        s.TaxRate = request.TaxRate;
        s.ReceiptFooter = request.ReceiptFooter.Trim();
        s.ShowLogoOnReceipt = request.ShowLogoOnReceipt;
        await _db.SaveChangesAsync();
        return Map(s);
    }

    private static StoreSettingDto Map(StoreSetting s) => new()
    {
        Id = s.Id,
        StoreName = s.StoreName,
        Phone = s.Phone,
        Email = s.Email,
        Address = s.Address,
        Currency = s.Currency,
        CurrencySymbol = s.CurrencySymbol,
        TaxRate = s.TaxRate,
        ReceiptFooter = s.ReceiptFooter,
        ShowLogoOnReceipt = s.ShowLogoOnReceipt
    };
}
