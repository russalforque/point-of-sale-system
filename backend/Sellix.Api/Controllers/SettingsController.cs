using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sellix.Api.DTOs.Settings;
using Sellix.Api.Services;

namespace Sellix.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/settings")]
public class SettingsController : ControllerBase
{
    private readonly SettingsService _service;

    public SettingsController(SettingsService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<StoreSettingDto>> Get() => Ok(await _service.GetAsync());

    [HttpPut]
    public async Task<ActionResult<StoreSettingDto>> Update(UpdateStoreSettingRequest request)
        => Ok(await _service.UpdateAsync(request));
}
