using System.Globalization;
using Sellix.Api.DTOs.Printing;
using Sellix.Api.Data;
using Sellix.Api.Models;

namespace Sellix.Api.Services.Printing;

public sealed class ReceiptPrintService : IReceiptPrintService
{
    private readonly AppDbContext _db;

    public ReceiptPrintService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<Guid> PrintAsync(ReceiptPrintRequest request, CancellationToken cancellationToken)
    {
        Validate(request);
        var width = request.CharactersPerLine;
        var builder = new EscPosBuilder().Initialize().SetAlignment(1).SetBold(true)
            .SetTextSize(doubleWidth: true).WriteLine(request.StoreName)
            .SetTextSize().SetBold(false);
        if (!string.IsNullOrWhiteSpace(request.StoreAddress)) builder.WriteLine(request.StoreAddress!);
        if (!string.IsNullOrWhiteSpace(request.StorePhone)) builder.WriteLine(request.StorePhone!);
        builder.Separator(width).WriteLine("SALES RECEIPT").Separator(width).SetAlignment(0)
            .WriteLine($"Receipt: {request.ReceiptNumber}")
            .WriteLine($"Date: {request.TransactionDate.ToLocalTime():yyyy-MM-dd HH:mm}")
            .WriteLine($"Cashier: {request.CashierName}");
        if (!string.IsNullOrWhiteSpace(request.CustomerName)) builder.WriteLine($"Customer: {request.CustomerName}");
        builder.Separator(width).WriteLine(Columns("ITEM", "QTY", "PRICE", width)).Separator(width);
        foreach (var item in request.Items)
        {
            var nameWidth = Math.Max(8, width - item.Quantity.ToString(CultureInfo.InvariantCulture).Length - Money(item.UnitPrice).Length - 2);
            var nameLines = Wrap(item.ProductName, nameWidth);
            builder.WriteLine(Columns(nameLines[0], item.Quantity.ToString(CultureInfo.InvariantCulture), Money(item.UnitPrice), width));
            foreach (var line in nameLines.Skip(1)) builder.WriteLine(line);
        }
        builder.Separator(width).WriteLine(Amounts("Subtotal", request.Subtotal, width))
            .WriteLine(Amounts("Discount", -request.DiscountTotal, width))
            .WriteLine(Amounts("Tax", request.Tax, width)).SetBold(true)
            .WriteLine(Amounts("TOTAL", request.GrandTotal, width)).SetBold(false).Separator(width)
            .WriteLine(Amounts(request.PaymentMethod, request.AmountPaid ?? request.GrandTotal, width));
        if (request.Change.HasValue) builder.WriteLine(Amounts("Change", request.Change.Value, width));
        builder.Separator(width).SetAlignment(1);
        if (!string.IsNullOrWhiteSpace(request.FooterMessage)) builder.WriteLine(request.FooterMessage!);
        builder.WriteLine("THANK YOU!").WriteLine("PLEASE COME AGAIN").Feed(3).Cut();
        if (request.OpenCashDrawer && request.PaymentMethod.Equals("Cash", StringComparison.OrdinalIgnoreCase)) builder.OpenCashDrawer();

        var job = new PrintJob
        {
            TransactionId = request.TransactionId,
            ReceiptNumber = request.ReceiptNumber,
            DataBase64 = Convert.ToBase64String(builder.ToArray()),
            OpenCashDrawer = request.OpenCashDrawer
        };
        _db.PrintJobs.Add(job);
        await _db.SaveChangesAsync(cancellationToken);
        return job.PrintJobId;
    }

    private static void Validate(ReceiptPrintRequest request)
    {
        if (request.Items.Count == 0 || request.GrandTotal < 0 || request.DiscountTotal > request.Subtotal)
            throw new ArgumentException("Receipt data is invalid.");
    }

    private static string Money(decimal value) => value.ToString("N2", CultureInfo.InvariantCulture);
    private static string Amounts(string label, decimal value, int width) => label.PadRight(Math.Max(1, width - Money(value).Length)) + Money(value);
    private static string Columns(string name, string quantity, string price, int width)
    {
        var nameWidth = Math.Max(8, width - quantity.Length - price.Length - 2);
        return name[..Math.Min(name.Length, nameWidth)].PadRight(nameWidth)
            + quantity.PadLeft(quantity.Length + 1)
            + price.PadLeft(price.Length + 1);
    }
    private static List<string> Wrap(string value, int width)
    {
        var words = value.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var lines = new List<string>();
        var current = "";
        foreach (var word in words)
        {
            if (current.Length > 0 && current.Length + word.Length + 1 > width) { lines.Add(current); current = ""; }
            current += (current.Length == 0 ? "" : " ") + word;
        }
        if (current.Length > 0 || lines.Count == 0) lines.Add(current);
        return lines;
    }
}