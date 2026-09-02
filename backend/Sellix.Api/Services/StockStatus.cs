namespace Sellix.Api.Services;

public static class StockStatus
{
    public static string FromQuantity(int quantity, int reorderLevel)
    {
        if (quantity <= 0) return "Out of Stock";
        if (quantity <= reorderLevel) return "Low Stock";
        return "In Stock";
    }
}
