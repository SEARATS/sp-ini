Sea Power INI for PSPad

Extract both files to a permanent folder (for example C:\Tools\SeaPowerINI).
Install Node.js 22.13 or newer if needed.

Under Settings > Highlighter Settings, choose the INI highlighter and open
the Compiler tab. Enter the full path to node.exe in the Compiler field.
For Parameters, enter the line below and adjust the path to your folder:

"C:\Tools\SeaPowerINI\pspad.js" "%File%" %Line%

Enable Capture Program Output Window. Set the LOG parser to:

%F|%L|%C|

Save an INI and run Compile. The log lists definitions for references on
the current line, followed by diagnostics for the file. Double-click a
result to open the corresponding file and line.

Project and updates: https://github.com/SEARATS/sp-ini/releases
