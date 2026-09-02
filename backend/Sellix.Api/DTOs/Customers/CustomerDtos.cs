using System.ComponentModel.DataAnnotations;

namespace Sellix.Api.DTOs.Customers;

public class CustomerDto
{
    public int Id { get; set; }
    public string CustomerCode { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Address { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public int LoyaltyPoints { get; set; }
}

public class UpsertCustomerRequest
{
    [Required, MaxLength(200)]
    public string FullName { get; set; } = string.Empty;

    [MaxLength(40)]
    public string? Phone { get; set; }

    [EmailAddress, MaxLength(160)]
    public string? Email { get; set; }

    [MaxLength(400)]
    public string? Address { get; set; }

    public bool IsActive { get; set; } = true;
}
