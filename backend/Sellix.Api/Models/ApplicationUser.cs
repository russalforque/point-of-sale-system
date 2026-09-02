using Microsoft.AspNetCore.Identity;

namespace Sellix.Api.Models;

public class ApplicationUser : IdentityUser
{
    public string FullName { get; set; } = string.Empty;
}
