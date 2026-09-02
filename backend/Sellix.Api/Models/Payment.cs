namespace Sellix.Api.Models;

public class Payment
{
    public int Id { get; set; }
    public int SaleId { get; set; }
    public PaymentMethod Method { get; set; }
    public decimal Amount { get; set; }
    public decimal? AmountReceived { get; set; }
    public decimal? Change { get; set; }
    public string? Reference { get; set; }

    public Sale Sale { get; set; } = null!;
}
