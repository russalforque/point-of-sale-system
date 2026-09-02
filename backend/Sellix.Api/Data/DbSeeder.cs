using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.Models;

namespace Sellix.Api.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();

        await db.Database.MigrateAsync();

        if (!await db.StoreSettings.AnyAsync())
        {
            db.StoreSettings.Add(new StoreSetting
            {
                StoreName = "Sellix Market",
                Phone = "+63 917 555 0142",
                Email = "hello@sellix.local",
                Address = "2F Pioneer Plaza, Makati City",
                Currency = "PHP",
                CurrencySymbol = "₱",
                TaxRate = 0.12m,
                ReceiptFooter = "Thank you for shopping at Sellix Market.",
                ShowLogoOnReceipt = true
            });
            await db.SaveChangesAsync();
        }

        var admin = await users.FindByEmailAsync("admin@sellix.local");
        if (admin is null)
        {
            admin = new ApplicationUser
            {
                UserName = "admin@sellix.local",
                Email = "admin@sellix.local",
                EmailConfirmed = true,
                FullName = "Angelica Admin"
            };
            var created = await users.CreateAsync(admin, "Admin123!");
            if (!created.Succeeded)
                throw new InvalidOperationException("Failed to seed admin user.");
        }

        if (await db.Products.AnyAsync())
            return;

        var categories = new[]
        {
            new Category { Name = "Beverages", Description = "Drinks and refreshments" },
            new Category { Name = "Snacks", Description = "Chips, biscuits, and treats" },
            new Category { Name = "Grocery", Description = "Everyday pantry items" },
            new Category { Name = "Personal Care", Description = "Toiletries and hygiene" },
            new Category { Name = "Household", Description = "Cleaning and home supplies" }
        };
        db.Categories.AddRange(categories);

        var suppliers = new[]
        {
            new Supplier { SupplierCode = "SUP-0001", CompanyName = "Metro Distro Inc.", ContactPerson = "Rico Santos", Phone = "02-8891-1100", Email = "orders@metrodistro.ph", Address = "Quezon City" },
            new Supplier { SupplierCode = "SUP-0002", CompanyName = "Island Goods Co.", ContactPerson = "Mia Cruz", Phone = "02-8721-4400", Email = "sales@islandgoods.ph", Address = "Pasig City" },
            new Supplier { SupplierCode = "SUP-0003", CompanyName = "CleanLine Trading", ContactPerson = "Joel Reyes", Phone = "02-8551-2200", Email = "hello@cleanline.ph", Address = "Caloocan" }
        };
        db.Suppliers.AddRange(suppliers);
        await db.SaveChangesAsync();

        var now = DateTime.UtcNow;
        var products = new List<Product>
        {
            P("BEV-001", "Coke 1.5L", categories[0].Id, suppliers[0].Id, 48, 68, 42, 12, now),
            P("BEV-002", "Royal 1.5L", categories[0].Id, suppliers[0].Id, 46, 65, 35, 12, now),
            P("BEV-003", "Bottled Water 500ml", categories[0].Id, suppliers[0].Id, 8, 15, 120, 24, now),
            P("BEV-004", "Iced Tea Lemon 500ml", categories[0].Id, suppliers[1].Id, 18, 28, 54, 15, now),
            P("BEV-005", "Instant Coffee 3-in-1", categories[0].Id, suppliers[1].Id, 6, 10, 8, 20, now),
            P("SNK-001", "Potato Chips Classic", categories[1].Id, suppliers[1].Id, 22, 35, 60, 15, now),
            P("SNK-002", "Chocolate Bar 40g", categories[1].Id, suppliers[1].Id, 18, 32, 4, 10, now),
            P("SNK-003", "Crackers Family Pack", categories[1].Id, suppliers[1].Id, 38, 55, 28, 10, now),
            P("SNK-004", "Cup Noodles Beef", categories[1].Id, suppliers[0].Id, 16, 25, 70, 20, now),
            P("GRO-001", "Rice 5kg", categories[2].Id, suppliers[0].Id, 220, 265, 18, 8, now),
            P("GRO-002", "Cooking Oil 1L", categories[2].Id, suppliers[0].Id, 85, 110, 22, 8, now),
            P("GRO-003", "Canned Tuna 155g", categories[2].Id, suppliers[0].Id, 28, 42, 48, 16, now),
            P("GRO-004", "Soy Sauce 1L", categories[2].Id, suppliers[0].Id, 32, 48, 2, 8, now),
            P("GRO-005", "Eggs Tray 12s", categories[2].Id, suppliers[1].Id, 95, 120, 14, 6, now),
            P("PER-001", "Shampoo 180ml", categories[3].Id, suppliers[2].Id, 72, 99, 16, 6, now),
            P("PER-002", "Toothpaste 150g", categories[3].Id, suppliers[2].Id, 48, 75, 21, 8, now),
            P("PER-003", "Bath Soap 90g", categories[3].Id, suppliers[2].Id, 18, 32, 40, 12, now),
            P("HSE-001", "Dishwashing Liquid 500ml", categories[4].Id, suppliers[2].Id, 38, 59, 19, 8, now),
            P("HSE-002", "Laundry Powder 1kg", categories[4].Id, suppliers[2].Id, 85, 125, 11, 6, now),
            P("HSE-003", "Trash Bags 20s", categories[4].Id, suppliers[2].Id, 42, 68, 0, 8, now)
        };
        db.Products.AddRange(products);

        var customers = new[]
        {
            new Customer { CustomerCode = "CUST-0001", FullName = "Ana Dela Cruz", Phone = "0917 111 2233", Email = "ana@email.com", Address = "Makati", IsActive = true, CreatedAt = now.AddDays(-40), LoyaltyPoints = 120 },
            new Customer { CustomerCode = "CUST-0002", FullName = "Benjie Ramos", Phone = "0918 444 7788", Email = "benjie@email.com", Address = "Pasay", IsActive = true, CreatedAt = now.AddDays(-28), LoyaltyPoints = 45 },
            new Customer { CustomerCode = "CUST-0003", FullName = "Carla Mendoza", Phone = "0920 333 5566", Email = "carla@email.com", Address = "Taguig", IsActive = true, CreatedAt = now.AddDays(-12), LoyaltyPoints = 80 },
            new Customer { CustomerCode = "CUST-0004", FullName = "Diego Villanueva", Phone = "0916 222 8899", Address = "Mandaluyong", IsActive = true, CreatedAt = now.AddDays(-6), LoyaltyPoints = 20 },
            new Customer { CustomerCode = "CUST-0005", FullName = "Elena Garcia", Phone = "0915 777 0011", Email = "elena@email.com", Address = "Paranaque", IsActive = false, CreatedAt = now.AddDays(-90), LoyaltyPoints = 0 }
        };
        db.Customers.AddRange(customers);
        await db.SaveChangesAsync();

        var rnd = new Random(42);
        var invoice = 1;
        for (var dayOffset = 14; dayOffset >= 0; dayOffset--)
        {
            var salesToday = dayOffset == 0 ? 8 : rnd.Next(3, 7);
            for (var n = 0; n < salesToday; n++)
            {
                var when = now.Date.AddDays(-dayOffset).AddHours(9 + rnd.Next(0, 10)).AddMinutes(rnd.Next(0, 59));
                var pick = products.Where(p => p.StockQuantity > 2).OrderBy(_ => rnd.Next()).Take(rnd.Next(1, 4)).ToList();
                if (pick.Count == 0) continue;

                var items = new List<SaleItem>();
                decimal subtotal = 0;
                foreach (var product in pick)
                {
                    var qty = Math.Min(rnd.Next(1, 3), Math.Max(product.StockQuantity - 1, 1));
                    product.StockQuantity -= qty;
                    product.UpdatedAt = when;
                    var line = product.SellingPrice * qty;
                    subtotal += line;
                    items.Add(new SaleItem { ProductId = product.Id, Quantity = qty, UnitPrice = product.SellingPrice, LineTotal = line });
                    db.InventoryTransactions.Add(new InventoryTransaction
                    {
                        ProductId = product.Id,
                        Type = InventoryTransactionType.Sale,
                        QuantityChange = -qty,
                        QuantityAfter = product.StockQuantity,
                        Reason = "POS sale",
                        CreatedBy = admin.Id,
                        CreatedAt = when
                    });
                }

                var discount = n % 5 == 0 ? 10 : 0;
                var taxable = Math.Max(subtotal - discount, 0);
                var tax = Math.Round(taxable * 0.12m, 2, MidpointRounding.AwayFromZero);
                var total = taxable + tax;
                var method = (PaymentMethod)(n % 4);
                var customerId = n % 3 == 0 ? customers[n % 4].Id : (int?)null;

                var sale = new Sale
                {
                    InvoiceNumber = $"SLX-{when:yyyyMMdd}-{invoice:D4}",
                    CustomerId = customerId,
                    CashierId = admin.Id,
                    Subtotal = subtotal,
                    Discount = discount,
                    Tax = tax,
                    Total = total,
                    Status = SaleStatus.Completed,
                    CreatedAt = when,
                    SaleItems = items,
                    Payment = new Payment
                    {
                        Method = method,
                        Amount = total,
                        AmountReceived = method == PaymentMethod.Cash ? total + 20 : null,
                        Change = method == PaymentMethod.Cash ? 20 : null
                    }
                };
                invoice++;
                db.Sales.Add(sale);
            }
        }

        await db.SaveChangesAsync();
    }

    private static Product P(string sku, string name, int cat, int sup, decimal cost, decimal sell, int stock, int reorder, DateTime now) =>
        new()
        {
            SKU = sku,
            Name = name,
            CategoryId = cat,
            SupplierId = sup,
            CostPrice = cost,
            SellingPrice = sell,
            StockQuantity = stock,
            ReorderLevel = reorder,
            IsActive = true,
            CreatedAt = now.AddDays(-20),
            UpdatedAt = now
        };
}
