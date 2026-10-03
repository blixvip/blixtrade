' Runs the Cloudflare Tunnel that puts Blix on trade.blixvip.com, hidden (no console window).
' The tunnel is named "blix"; its config lives in %USERPROFILE%\.cloudflared\config.yml.
Set sh = CreateObject("WScript.Shell")
Set env = sh.Environment("PROCESS")
cfg = env("USERPROFILE") & "\.cloudflared\config.yml"
sh.Run """C:\Program Files (x86)\cloudflared\cloudflared.exe"" tunnel --config """ & cfg & """ run blix", 0, False
