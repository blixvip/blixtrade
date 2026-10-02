' Opens Blix with no console window. Pass /background to only start the radar.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
args = ""
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "/background" Then args = " --background"
End If
sh.Run "node """ & dir & "\bin\open.mjs""" & args, 0, False
