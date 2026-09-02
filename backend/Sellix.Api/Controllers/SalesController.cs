using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sellix.Api.DTOs.Common;
using Sellix.Api.DTOs.Sales;
using Sellix.Api.Services;

namespace Sellix.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/sales")]
public class SalesController : ControllerBase
{
    private readonly SalesService _service;

    public SalesController(SalesService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<SaleDto>>> List(
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10)
        => Ok(await _service.ListAsync(search, page, pageSize));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SaleDto>> Get(int id) => Ok(await _service.GetAsync(id));

    [HttpPost]
    public async Task<ActionResult<SaleDto>> Create(CreateSaleRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new InvalidOperationException("Missing user id.");
        var created = await _service.CreateAsync(request, userId);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }
}
