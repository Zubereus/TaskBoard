# Running two development instances

Run `npm run dev:test` from the project root to start Vite and two Electron windows:

- **HOST** and **CLIENT** are separate development instances with independent Electron profiles and app data under the operating system's temporary directory (`%TEMP%\taskboard-devtest\host` and `%TEMP%\taskboard-devtest\client` on Windows).
- In the HOST window, open **Đồng bộ LAN** and start the host.
- In the CLIENT window, open **Đồng bộ LAN** and connect to `127.0.0.1` on port `22236`.
- Clients can add shared tasks and mark them complete. Only the host can edit or delete shared tasks. Disconnecting keeps the client role and these restrictions; choosing local standalone mode is a separate action.
- If a shared task disappears from a client's local cache while disconnected, reconnecting downloads the host's current shared tasks again. This is covered by `npm test` in `server/lan-sync.test.js`.
- The **Trò chuyện** sidebar tab has group and direct conversations for connected devices, listed by their app display name. Direct messages are routed by the host only to the sender and selected recipient; they are not end-to-end encrypted.
- Press `Ctrl+C` in the terminal to stop Vite and both windows.

This mode bypasses the single-instance lock only for these two development processes. Normal development and packaged app launches retain the single-instance behavior and existing data locations.

Devtest data is kept outside the project and normal app data. To clear it on Windows, close both test windows and remove `%TEMP%\taskboard-devtest`.
