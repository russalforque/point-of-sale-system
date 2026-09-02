using System.ComponentModel.DataAnnotations;

namespace Sellix.Api.DTOs.Suppliers;

public class SupplierDto
{
    public int Id { get; set; }
    public string SupplierCode { get; set; } = string.Empty;
    public string CompanyName { get; set; } = string.Empty;
    public string? ContactPerson { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Address { get; set; }
    public bool IsActive { get; set; }
}

public class UpsertSupplierRequest
{
    [Required, MaxLength(200)]
    public string CompanyName { get; set; } = string.Empty;

    [MaxLength(160)]
    public string? ContactPerson { get; set; }

    [MaxLength(40)]
    public string? Phone { get; set; }

    [EmailAddress, MaxLength(160)]
    public string? Email { get; set; }

    [MaxLength(400)]
    public string? Address { get; set; }

    public bool IsActive { get; set; } = true;
}
