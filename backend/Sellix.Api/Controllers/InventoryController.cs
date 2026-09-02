using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sellix.Api.DTOs.Common;
using Sellix.Api.DTOs.Inventory;
using Sellix.Api.Services;

namespace Sellix.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/inventory")]
public class InventoryController : ControllerBase
{
    private readonly InventoryService _service;

    public InventoryController(InventoryService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<InventoryItemDto>>> List(
        [FromQuery] string? search,
        [FromQuery] string? stockStatus,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10)
        => Ok(await _service.ListAsync(search, stockStatus, page, pageSize));

    [HttpGet("history")]
    public async Task<ActionResult<PagedResult<InventoryHistoryDto>>> History(
        [FromQuery] int? productId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10)
        => Ok(await _service.HistoryAsync(productId, page, pageSize));

    [HttpPost("adjust")]
    public async Task<IActionResult> Adjust(AdjustStockRequest request)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        await _service.AdjustAsync(request, userId);
        return Ok(new { message = "Stock updated." });
    }
}
