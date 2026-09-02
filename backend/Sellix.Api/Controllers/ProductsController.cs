using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sellix.Api.DTOs.Common;
using Sellix.Api.DTOs.Products;
using Sellix.Api.Services;

namespace Sellix.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/products")]
public class ProductsController : ControllerBase
{
    private readonly ProductService _service;

    public ProductsController(ProductService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<ProductDto>>> List(
        [FromQuery] string? search,
        [FromQuery] int? categoryId,
        [FromQuery] string? stockStatus,
        [FromQuery] bool? isActive,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10)
        => Ok(await _service.ListAsync(search, categoryId, stockStatus, isActive, page, pageSize));

    [HttpGet("catalog")]
    public async Task<ActionResult<List<ProductDto>>> Catalog([FromQuery] string? search, [FromQuery] int? categoryId)
        => Ok(await _service.PosCatalogAsync(search, categoryId));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ProductDto>> Get(int id) => Ok(await _service.GetAsync(id));

    [HttpPost]
    public async Task<ActionResult<ProductDto>> Create(UpsertProductRequest request)
    {
        var created = await _service.CreateAsync(request);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<ProductDto>> Update(int id, UpsertProductRequest request)
        => Ok(await _service.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await _service.DeactivateAsync(id);
        return NoContent();
    }
}
