Option Explicit

Dim shell, fileSystem, root, launcherPath, command, argument, exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

root = fileSystem.GetParentFolderName(WScript.ScriptFullName)
launcherPath = fileSystem.BuildPath(root, "scripts\start-dev-hidden.vbs")
command = QuoteArgument(fileSystem.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), _
    "System32\wscript.exe")) & " //nologo " & QuoteArgument(launcherPath)

For Each argument In WScript.Arguments
    command = command & " " & QuoteArgument(CStr(argument))
Next

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
