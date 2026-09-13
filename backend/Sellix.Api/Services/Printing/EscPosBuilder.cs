using System.Text;

namespace Sellix.Api.Services.Printing;

public sealed class EscPosBuilder
{
    private readonly List<byte> _bytes = new();
    private readonly Encoding _encoding = new UTF8Encoding(false);

    public EscPosBuilder Initialize() => Command(0x1B, 0x40);
    public EscPosBuilder SetAlignment(byte alignment) => Command(0x1B, 0x61, alignment);
    public EscPosBuilder SetBold(bool enabled) => Command(0x1B, 0x45, enabled ? (byte)1 : (byte)0);
    public EscPosBuilder SetTextSize(bool doubleWidth = false, bool doubleHeight = false)
        => Command(0x1D, 0x21, (byte)((doubleWidth ? 0x10 : 0) | (doubleHeight ? 0x01 : 0)));
    public EscPosBuilder WriteText(string value) { _bytes.AddRange(_encoding.GetBytes(value)); return this; }
    public EscPosBuilder WriteLine(string value = "") => WriteText(value).Feed();
    public EscPosBuilder Feed(int lines = 1) { for (var i = 0; i < lines; i++) _bytes.Add(0x0A); return this; }
    public EscPosBuilder Separator(int width) => WriteLine(new string('-', width));
    public EscPosBuilder Cut() => Command(0x1D, 0x56, 0x00);
    public EscPosBuilder OpenCashDrawer() => Command(0x1B, 0x70, 0x00, 0x19, 0xFA);

    public EscPosBuilder PrintQRCode(string value, byte size = 5, byte errorCorrection = 49)
    {
        var data = _encoding.GetBytes(value);
        var length = data.Length + 3;
        Command(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
        Command(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size);
        Command(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, errorCorrection);
        _bytes.AddRange(new byte[] { 0x1D, 0x28, 0x6B, (byte)(length & 0xFF), (byte)(length >> 8), 0x31, 0x50, 0x30 });
        _bytes.AddRange(data);
        Command(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);
        return this;
    }

    public EscPosBuilder PrintBarcode(string value)
    {
        var data = _encoding.GetBytes(value);
        Command(0x1D, 0x68, 80, 0x1D, 0x77, 2, 0x1D, 0x48, 2);
        _bytes.AddRange(new byte[] { 0x1D, 0x6B, 0x04, (byte)data.Length });
        _bytes.AddRange(data);
        return this;
    }

    public byte[] ToArray() => _bytes.ToArray();

    private EscPosBuilder Command(params byte[] command) { _bytes.AddRange(command); return this; }
}