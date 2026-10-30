param(
  [int]$X,
  [int]$Y,
  [switch]$Right,
  [switch]$Foreground,
  [string]$ProcessName = 'lx-music-desktop'
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class OsMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public const uint LD = 0x0002, LU = 0x0004, RD = 0x0008, RU = 0x0010;
}
'@ -ErrorAction SilentlyContinue

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "ERR no-window"; exit 1 }

if ($Foreground) {
  [OsMouse]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [OsMouse]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 600
}

$r = New-Object OsMouse+RECT
[OsMouse]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null

if ($X -lt 0 -and $Y -lt 0) {
  Write-Output ("RECT {0} {1} {2} {3}" -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))
  exit 0
}

[OsMouse]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 200
if ($Right) {
  [OsMouse]::mouse_event([OsMouse]::RD, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 110
  [OsMouse]::mouse_event([OsMouse]::RU, 0, 0, 0, [UIntPtr]::Zero)
} else {
  [OsMouse]::mouse_event([OsMouse]::LD, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 110
  [OsMouse]::mouse_event([OsMouse]::LU, 0, 0, 0, [UIntPtr]::Zero)
}
Write-Output ("OK {0},{1} right={2} rect={3},{4},{5},{6}" -f $X, $Y, $Right, $r.Left, $r.Top, ($r.Right-$r.Left), ($r.Bottom-$r.Top))
