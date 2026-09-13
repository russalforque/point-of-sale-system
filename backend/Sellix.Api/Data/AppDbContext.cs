using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Sellix.Api.Models;

namespace Sellix.Api.Data;

public class AppDbContext : IdentityDbContext<ApplicationUser>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Sale> Sales => Set<Sale>();
    public DbSet<SaleItem> SaleItems => Set<SaleItem>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<InventoryTransaction> InventoryTransactions => Set<InventoryTransaction>();
    public DbSet<StoreSetting> StoreSettings => Set<StoreSetting>();
    public DbSet<PrintJob> PrintJobs => Set<PrintJob>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Category>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(120).IsRequired();
            e.Property(x => x.Description).HasMaxLength(500);
            e.HasIndex(x => x.Name).IsUnique();
        });

        builder.Entity<Supplier>(e =>
        {
            e.Property(x => x.SupplierCode).HasMaxLength(40).IsRequired();
            e.Property(x => x.CompanyName).HasMaxLength(200).IsRequired();
            e.Property(x => x.ContactPerson).HasMaxLength(160);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.Email).HasMaxLength(160);
            e.Property(x => x.Address).HasMaxLength(400);
            e.HasIndex(x => x.SupplierCode).IsUnique();
        });

        builder.Entity<Customer>(e =>
        {
            e.Property(x => x.CustomerCode).HasMaxLength(40).IsRequired();
            e.Property(x => x.FullName).HasMaxLength(200).IsRequired();
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.Email).HasMaxLength(160);
            e.Property(x => x.Address).HasMaxLength(400);
            e.HasIndex(x => x.CustomerCode).IsUnique();
            e.HasIndex(x => x.FullName);
        });

        builder.Entity<Product>(e =>
        {
            e.Property(x => x.SKU).HasMaxLength(60).IsRequired();
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Description).HasMaxLength(800);
            e.Property(x => x.ImageUrl).HasColumnType("nvarchar(max)");
            e.Property(x => x.CostPrice).HasPrecision(18, 2);
            e.Property(x => x.SellingPrice).HasPrecision(18, 2);
            e.HasIndex(x => x.SKU).IsUnique();
            e.HasIndex(x => x.Name);
            e.HasIndex(x => x.CategoryId);
            e.HasOne(x => x.Category).WithMany(c => c.Products).HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Supplier).WithMany(s => s.Products).HasForeignKey(x => x.SupplierId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<Sale>(e =>
        {
            e.Property(x => x.InvoiceNumber).HasMaxLength(40).IsRequired();
            e.Property(x => x.Subtotal).HasPrecision(18, 2);
            e.Property(x => x.Discount).HasPrecision(18, 2);
            e.Property(x => x.Tax).HasPrecision(18, 2);
            e.Property(x => x.Total).HasPrecision(18, 2);
            e.HasIndex(x => x.InvoiceNumber).IsUnique();
            e.HasIndex(x => x.CreatedAt);
            e.HasOne(x => x.Customer).WithMany(c => c.Sales).HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Cashier).WithMany().HasForeignKey(x => x.CashierId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<SaleItem>(e =>
        {
            e.Property(x => x.UnitPrice).HasPrecision(18, 2);
            e.Property(x => x.LineTotal).HasPrecision(18, 2);
            e.HasOne(x => x.Sale).WithMany(s => s.SaleItems).HasForeignKey(x => x.SaleId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Product).WithMany(p => p.SaleItems).HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Payment>(e =>
        {
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.AmountReceived).HasPrecision(18, 2);
            e.Property(x => x.Change).HasPrecision(18, 2);
            e.Property(x => x.Reference).HasMaxLength(80);
            e.HasIndex(x => x.SaleId).IsUnique();
            e.HasOne(x => x.Sale).WithOne(s => s.Payment).HasForeignKey<Payment>(x => x.SaleId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<InventoryTransaction>(e =>
        {
            e.Property(x => x.Reason).HasMaxLength(300).IsRequired();
            e.HasOne(x => x.Product).WithMany(p => p.InventoryTransactions).HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.CreatedAt);
        });

        builder.Entity<StoreSetting>(e =>
        {
            e.Property(x => x.StoreName).HasMaxLength(200).IsRequired();
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.Email).HasMaxLength(160);
            e.Property(x => x.Address).HasMaxLength(400);
            e.Property(x => x.Currency).HasMaxLength(10);
            e.Property(x => x.CurrencySymbol).HasMaxLength(8);
            e.Property(x => x.TaxRate).HasPrecision(5, 4);
            e.Property(x => x.ReceiptFooter).HasMaxLength(400);
        });

        builder.Entity<PrintJob>(e =>
        {
            e.Property(x => x.ReceiptNumber).HasMaxLength(80).IsRequired();
            e.Property(x => x.DataBase64).IsRequired();
            e.Property(x => x.LastError).HasMaxLength(500);
            e.HasIndex(x => x.PrintJobId).IsUnique();
            e.HasIndex(x => new { x.Status, x.CreatedAt });
        });
    }
}
