using System.ComponentModel;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Options;

namespace Sellix.PrintAgent;

public sealed class PrinterService
{
    private readonly PrinterConfiguration _configuration;
    private readonly ILogger<PrinterService> _logger;
    private readonly IHttpClientFactory _httpClientFactory;

    public PrinterService(IOptions<PrinterConfiguration> configuration, ILogger<PrinterService> logger, IHttpClientFactory httpClientFactory)
    {
        _configuration = configuration.Value;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
    }

    public object GetStatus()
    {
        try
        {
            using var printer = RawPrinter.Open(_configuration.PrinterName);
            return new { status = "ready", printerName = _configuration.PrinterName, paperWidth = _configuration.PaperWidth };
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Printer status check failed for {PrinterName}", _configuration.PrinterName);
            return new { status = "offline", printerName = _configuration.PrinterName, error = exception.Message };
        }
    }

    public Task PrintAsync(PrintAgentJob job, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(job.DataBase64)) throw new InvalidDataException("Print data is empty.");
        var bytes = Convert.FromBase64String(job.DataBase64);
        using var printer = RawPrinter.Open(_configuration.PrinterName);
        printer.Write(bytes);
        _logger.LogInformation("Printed receipt {ReceiptNumber} as job {PrintJobId}", job.ReceiptNumber, job.PrintJobId);
        return Task.CompletedTask;
    }

    public async Task PollAsync(CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Sellix-Agent-Key", _configuration.AgentKey);
        var apiUrl = _configuration.ApiUrl.TrimEnd('/');
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var response = await client.GetAsync($"{apiUrl}/api/printing/agent/jobs/next", cancellationToken);
                if (response.StatusCode == System.Net.HttpStatusCode.NoContent)
                {
                    await Task.Delay(TimeSpan.FromSeconds(_configuration.PollIntervalSeconds), cancellationToken);
                    continue;
                }
                response.EnsureSuccessStatusCode();
                var job = await response.Content.ReadFromJsonAsync<PrintAgentJob>(cancellationToken);
                if (job is null) continue;
                try
                {
                    await PrintAsync(job, cancellationToken);
                    await client.PostAsync($"{apiUrl}/api/printing/agent/jobs/{job.PrintJobId}/complete", null, cancellationToken);
                }
                catch (Exception exception)
                {
                    await client.PostAsJsonAsync($"{apiUrl}/api/printing/agent/jobs/{job.PrintJobId}/fail", new { message = exception.Message }, cancellationToken);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Print queue polling failed");
                await Task.Delay(TimeSpan.FromSeconds(_configuration.PollIntervalSeconds), cancellationToken);
            }
        }
    }
}

internal sealed class RawPrinter : IDisposable
{
    private readonly nint _handle;
    private RawPrinter(nint handle) => _handle = handle;

    public static RawPrinter Open(string printerName)
    {
        if (!OpenPrinter(printerName, out var handle, nint.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return new RawPrinter(handle);
    }

    public void Write(byte[] bytes)
    {
        var document = new DOCINFO { pDocName = "Sellix Receipt", pDataType = "RAW" };
        if (StartDocPrinter(_handle, 1, document) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            if (!StartPagePrinter(_handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!WritePrinter(_handle, bytes, bytes.Length, out var written) || written != bytes.Length)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            EndPagePrinter(_handle);
        }
        finally { EndDocPrinter(_handle); }
    }

    public void Dispose() => ClosePrinter(_handle);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool OpenPrinter(string name, out nint handle, nint defaults);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool ClosePrinter(nint handle);
    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)] private static extern int StartDocPrinter(nint handle, int level, [In] DOCINFO info);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool EndDocPrinter(nint handle);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool StartPagePrinter(nint handle);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool EndPagePrinter(nint handle);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool WritePrinter(nint handle, byte[] bytes, int count, out int written);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private sealed class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDataType;
    }
}