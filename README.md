
## ESC/POS printing

Sellix sends completed receipt data to `POST /api/printing/receipt`. The API formats the data as raw ESC/POS bytes and stores each job in the `PrintJobs` queue. The Windows agent polls the deployed API and prints locally, so the cloud API never needs to reach into the store network.

Apply the generated EF migration during deployment. Build and run `Sellix.PrintAgent` on each POS computer, then set `Printer:PrinterName` to the exact Windows printer queue name, `Printer:ApiUrl` to the deployed API URL, and use the same strong random value for `Printer:AgentKey` and the API's `Printing:AgentKey`. The agent uses the Windows spooler RAW path and never replaces the USB Printing Support driver.
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
