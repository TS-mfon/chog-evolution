# React Bits registry and Codex MCP

The web workspace's `components.json` registers `@react-bits` at `https://reactbits.dev/r/{name}.json`. Use TypeScript + CSS variants with the current CSS design system.

The requested Codex server entry is prepared in `config/codex-mcp.toml`. Set its `cwd` to your absolute `apps/web` path, merge the entry into your Codex configuration, then restart the client. The standard command is `npx shadcn@latest mcp` with the working directory set to `apps/web`. From the repository root, `npm run mcp:react-bits` starts the same registry server in that workspace.

Once connected, search the registry for FadeContent, ScrollReveal and Dither. Read their registry definitions, install selected TypeScript + CSS variants into the web workspace, and preserve the purple/black design tokens and reduced-motion behavior.

On 2026-10-19 this workspace could not resolve reactbits.dev or registry.npmjs.org, and both `.codex` in the workspace and the global Codex configuration were outside permitted write locations. The actual server and remote components therefore could not be installed or used in this session. The current animations are bespoke native CSS/IntersectionObserver implementations, not claimed as React Bits components. No simulated registry or MCP result is substituted.
