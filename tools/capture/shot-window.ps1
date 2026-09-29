# Capture a process's main window to a PNG (docs/media/cli-live.png).
# Usage: powershell -ExecutionPolicy Bypass -File tools/capture/shot-window.ps1 -ProcessName mintty -Out docs/media/cli-live.png
param(
  [Parameter(Mandatory = $true)][string]$ProcessName,
  [Parameter(Mandatory = $true)][string]$Out,
  # Optionally move the window first (screen coords) so always-on-top screen
  # overlays (webcam badges, watermarks) don't land inside the capture.
  [int]$Left = -1,
  [int]$Top = -1
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Native {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  // DWMWA_EXTENDED_FRAME_BOUNDS = 9: the visible window bounds, without the
  // invisible resize borders GetWindowRect reports (those leak whatever window
  // sits behind into CopyFromScreen captures).
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int sizeOfRect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[Native]::SetProcessDPIAware() | Out-Null
$proc = Get-Process $ProcessName -ErrorAction Stop |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1
if (-not $proc) { throw "no windowed process '$ProcessName'" }
$hwnd = $proc.MainWindowHandle
if ($Left -ge 0 -and $Top -ge 0) {
  # SWP_NOSIZE(0x1) | SWP_NOZORDER(0x4)
  [Native]::SetWindowPos($hwnd, [IntPtr]::Zero, $Left, $Top, 0, 0, 0x5) | Out-Null
}
[Native]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 600
$rect = New-Object Native+RECT
$hresult = [Native]::DwmGetWindowAttribute($hwnd, 9, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect))
if ($hresult -ne 0) { [Native]::GetWindowRect($hwnd, [ref]$rect) | Out-Null }
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { throw "bad window rect ${w}x${h}" }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved $Out ($w x $h)"
