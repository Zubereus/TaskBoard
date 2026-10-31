# Testing two development instances

Run `npm run dev:test` from the project root to start Vite and two Electron windows:

- **HOST** and **CLIENT** are isolated development instances. Each uses a separate Electron profile and stores its test data under `%TEMP%\taskboard-devtest\host` or `%TEMP%\taskboard-devtest\client` on Windows.
- In the HOST window, open LAN Sync and start the host.
- In the CLIENT window, open LAN Sync and connect to `127.0.0.1` on port `22236`.
- Clients can add shared tasks and mark them complete. Only the host can edit or delete shared tasks. Disconnecting preserves the client role and its restrictions; select standalone mode to switch back.
- If shared tasks disappear from a client's local cache while disconnected, reconnect to download the host's current shared tasks.
- The Chat view supports group and direct conversations for connected devices. Direct messages are routed by the host to the sender and selected recipient; messages are not end-to-end encrypted.
- Press `Ctrl+C` in the terminal to stop Vite and both windows.

This mode bypasses the single-instance lock only for these two development processes. Normal development and packaged launches retain the single-instance behavior and existing data locations.

Test data is kept outside the project and normal application data. To clear it on Windows, close both test windows and remove `%TEMP%\taskboard-devtest`.
