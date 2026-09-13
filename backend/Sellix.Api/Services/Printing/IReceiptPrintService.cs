using Sellix.Api.DTOs.Printing;

namespace Sellix.Api.Services.Printing;

public interface IReceiptPrintService
{
    Task<Guid> PrintAsync(ReceiptPrintRequest request, CancellationToken cancellationToken);
}