# Sea Power INI for Notepad++

1. Install Node.js 22.13 or newer and [NppLspClient](https://github.com/Ekopalypse/NppLspClient#installation) for your edition of Notepad++.
2. Extract this ZIP to a permanent folder. Run `./config.ps1` in PowerShell from that folder.
3. In **Plugins > NppLspClient > Open configuration**, add the printed block. If you already have an `[lspservers.ini]` block, choose which server to use for INI files. Save and apply the configuration.
4. Open your mod directory with **File > Open Folder as Workspace**, open an INI and choose **Start server for current language** from the plugin menu.

Tested with portable Notepad++ 8.9.9.1 x64 and NppLspClient 0.0.40-alpha. If that plugin reports an unknown `[calltip_dialog]` section in its generated configuration, comment out the empty section header and apply again.

Use the plugin menu for Go to Definition, completion, hover text and diagnostics. Start the server in each Sea Power session. The VS Code extension also includes image tooltips and the interactive model viewer.
