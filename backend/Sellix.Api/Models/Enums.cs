namespace Sellix.Api.Models;

public enum PaymentMethod
{
    Cash = 0,
    Card = 1,
    GCash = 2,
    Other = 3
}

public enum InventoryTransactionType
{
    Sale = 0,
    Increase = 1,
    Decrease = 2,
    Adjustment = 3
}

public enum SaleStatus
{
    Completed = 0,
    Voided = 1
}
