using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sellix.Api.DTOs.Reports;
using Sellix.Api.Services;

namespace Sellix.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/reports")]
public class ReportsController : ControllerBase
{
    private readonly ReportService _service;

    public ReportsController(ReportService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<ReportsDto>> Get([FromQuery] DateTime? from, [FromQuery] DateTime? to)
        => Ok(await _service.GetAsync(from, to));
}
