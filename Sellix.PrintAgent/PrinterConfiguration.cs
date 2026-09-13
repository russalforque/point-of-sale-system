namespace Sellix.PrintAgent;

public sealed class PrinterConfiguration
{
    public string PrinterName { get; set; } = "POS-58";
    public string ApiUrl { get; set; } = "http://localhost:5290";
    public string AgentKey { get; set; } = "change-this-agent-key-in-production";
    public int PollIntervalSeconds { get; set; } = 2;
    public int PaperWidth { get; set; } = 58;
    public int CharactersPerLine { get; set; } = 32;
    public bool AutoCut { get; set; } = true;
    public bool OpenCashDrawer { get; set; } = true;
}