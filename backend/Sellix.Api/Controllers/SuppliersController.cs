using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sellix.Api.DTOs.Suppliers;
using Sellix.Api.Services;

namespace Sellix.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/suppliers")]
public class SuppliersController : ControllerBase
{
    private readonly SupplierService _service;

    public SuppliersController(SupplierService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<List<SupplierDto>>> List([FromQuery] string? search, [FromQuery] bool? isActive)
        => Ok(await _service.ListAsync(search, isActive));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SupplierDto>> Get(int id) => Ok(await _service.GetAsync(id));

    [HttpPost]
    public async Task<ActionResult<SupplierDto>> Create(UpsertSupplierRequest request)
    {
        var created = await _service.CreateAsync(request);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<SupplierDto>> Update(int id, UpsertSupplierRequest request)
        => Ok(await _service.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await _service.DeactivateAsync(id);
        return NoContent();
    }
}
